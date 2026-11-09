// ReformANY Windows Explorer hold-and-shake.
//// Never infer the dragged file from Explorer's current selection.
//// The only launchable path comes from a *live* OLE IDataObject passed to
//// IDropTarget::DragEnter while the actual Shell drag is in progress.
//// An invisible, short-lived drop target is created ONLY after the complete
//// deliberate shake; normal drag-and-drop is not hooked or intercepted.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <ole2.h>
#include <shellapi.h>
#include <objidl.h>
#include <cwchar>
#include <string>
#include <vector>
#include <atomic>
#include <new>

namespace {
using Tick = unsigned char (*)(int, int, unsigned int, bool, bool);
using Launch = void (*)(const wchar_t *);
using Reload = void (*)();
Tick g_tick = nullptr;
Launch g_launch = nullptr;
Reload g_reload = nullptr;
HHOOK g_hook = nullptr;
HWND g_source = nullptr;
HWND g_captureWindow = nullptr;
bool g_down = false;
bool g_eligible = false;
bool g_requested = false;
std::wstring g_dragFile;
DWORD g_listenerThread = 0;

constexpr UINT kCaptureMsg = WM_APP + 0x52;
constexpr UINT kCapturedMsg = WM_APP + 0x53;
constexpr UINT kResetMsg = WM_APP + 0x54;
constexpr UINT_PTR kCaptureTimeout = 0x55;
constexpr int kCaptureWidth = 200;
constexpr wchar_t kCaptureClass[] = L"ReformANY_LiveDragCapture";
constexpr wchar_t kMutexName[] = L"Local\\ReformANY_OrbitShakeListener_1";
constexpr wchar_t kStopName[] = L"Local\\ReformANY_OrbitShakeStop_1";
constexpr wchar_t kReloadName[] = L"Local\\ReformANY_OrbitShakeReload_1";

bool class_is(HWND hwnd, const wchar_t* cls) {
    if (!hwnd) return false;
    wchar_t actual[128]{};
    return GetClassNameW(hwnd, actual, 128) > 0 && wcscmp(actual, cls) == 0;
}
bool is_shell_window(HWND root) {
    return class_is(root, L"CabinetWClass") || class_is(root, L"ExploreWClass") ||
           class_is(root, L"Progman") || class_is(root, L"WorkerW") ||
           root == GetShellWindow();
}
bool is_shell_items_area(HWND child, HWND root) {
    if (!is_shell_window(root)) return false;
    for (HWND test = child; test && test != root; test = GetParent(test)) {
        if (class_is(test, L"SHELLDLL_DefView") ||
            class_is(test, L"SysListView32") ||
            class_is(test, L"DirectUIHWND") ||
            class_is(test, L"ItemsView")) return true;
        if (class_is(test, L"Edit") ||
            class_is(test, L"ToolbarWindow32") ||
            class_is(test, L"SearchBox")) return false;
    }
    return false;
}
bool source_is_active(HWND source) {
    if (!source || !IsWindow(source)) return false;
    if (!(GetAsyncKeyState(VK_LBUTTON) & 0x8000)) return false;
    HWND foreground = GetForegroundWindow();
    foreground = foreground ? GetAncestor(foreground, GA_ROOT) : nullptr;
    return foreground == source ||
        (is_shell_window(source) &&
         (class_is(source,L"Progman") || class_is(source,L"WorkerW") ||
          source == GetShellWindow()) &&
         is_shell_window(foreground));
}
// Posting from the WH_MOUSE_LL callback is O(1). No COM, I/O, or Shell
// enumeration is performed inside the low-level mouse hook.
LRESULT CALLBACK hook(int code, WPARAM kind, LPARAM info) {
    if (code < 0 || !g_tick) return CallNextHookEx(g_hook, code, kind, info);
    const auto* mouse = reinterpret_cast<const MSLLHOOKSTRUCT*>(info);
    if (!mouse) return CallNextHookEx(g_hook, code, kind, info);
    if (kind == WM_LBUTTONDOWN) {
        const HWND child = WindowFromPoint(mouse->pt);
        const HWND root = child ? GetAncestor(child, GA_ROOT) : nullptr;
        g_eligible = is_shell_items_area(child, root);
        g_source = g_eligible ? root : nullptr;
        g_down = true;
        g_requested = false;
        g_tick(mouse->pt.x, mouse->pt.y, mouse->time, true, g_eligible);
    } else if (kind == WM_LBUTTONUP) {
        g_down = false;
        g_eligible = false;
        g_source = nullptr;
        g_requested = false;
        g_tick(mouse->pt.x, mouse->pt.y, mouse->time, false, false);
        PostThreadMessageW(g_listenerThread, kResetMsg, 0, 0);
    } else if (kind == WM_MOUSEMOVE && g_down) {
        const bool held = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
        const unsigned char phase = g_tick(mouse->pt.x, mouse->pt.y,
            mouse->time, held, g_eligible);
        // The Rust state machine returns 2 only for a deliberate, completed
        // multi-directional shake after a stable hold; 1 is NOT sufficient.
        if (phase == 2 && held && g_eligible && g_source && !g_requested) {
            g_requested = true;
            PostThreadMessageW(g_listenerThread, kCaptureMsg,
                reinterpret_cast<WPARAM>(g_source), 0);
            g_eligible = false;
        }
    }
    return CallNextHookEx(g_hook, code, kind, info);
}

// Only paths from this in-flight IDataObject are eligible. A Shell selection
// query is never a substitute: it can refer to a different file from the
// one being dragged, particularly after multi-select changes.
bool exact_file_from_data(IDataObject* object, std::wstring& path) {
    if (!object) return false;
    FORMATETC requested{ CF_HDROP, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL };
    STGMEDIUM value{};
    if (FAILED(object->GetData(&requested, &value))) return false;
    bool valid = false;
    const HDROP files = reinterpret_cast<HDROP>(value.hGlobal);
    if (files && DragQueryFileW(files, 0xFFFFFFFF, nullptr, 0) == 1) {
        const UINT length = DragQueryFileW(files, 0, nullptr, 0);
        if (length > 0 && length < 32760) {
            std::vector<wchar_t> buffer(static_cast<size_t>(length) + 1, 0);
            if (DragQueryFileW(files, 0, buffer.data(), length + 1) == length) {
                const DWORD attrs = GetFileAttributesW(buffer.data());
                if (attrs != INVALID_FILE_ATTRIBUTES &&
                    !(attrs & FILE_ATTRIBUTE_REPARSE_POINT)) {
                    path.assign(buffer.data(), length);
                    valid = true;
                }
            }
        }
    }
    ReleaseStgMedium(&value);
    return valid;
}

class DragCapture final : public IDropTarget {
    std::atomic<ULONG> refs_{1};
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (!result) return E_POINTER;
        *result = nullptr;
        if (IsEqualIID(iid, IID_IUnknown) ||
            IsEqualIID(iid, IID_IDropTarget)) {
            *result = static_cast<IDropTarget*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --refs_;
        if (!left) delete this;
        return left;
    }
    HRESULT STDMETHODCALLTYPE DragEnter(IDataObject* data, DWORD,
        POINTL, DWORD* effect) override {
        if (effect) *effect = DROPEFFECT_NONE;
        // This callback comes from OLE's active drag, not an Explorer
        // selected-item snapshot. Do not touch the file's bytes.
        if (source_is_active(g_source) && g_requested && g_dragFile.empty()) {
            std::wstring actual;
            if (exact_file_from_data(data, actual)) {
                g_dragFile = std::move(actual);
                PostThreadMessageW(g_listenerThread, kCapturedMsg, 0, 0);
            }
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragOver(DWORD, POINTL, DWORD* effect) override {
        if (effect) *effect = DROPEFFECT_NONE;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragLeave() override { return S_OK; }
    HRESULT STDMETHODCALLTYPE Drop(IDataObject*, DWORD, POINTL, DWORD* effect) override {
        if (effect) *effect = DROPEFFECT_NONE;
        return S_OK;
    }
};

LRESULT CALLBACK capture_proc(HWND hwnd, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_TIMER && w == kCaptureTimeout) {
        PostThreadMessageW(g_listenerThread, kResetMsg, 0, 0);
        return 0;
    }
    if (message == WM_ERASEBKGND) return 1;
    if (message == WM_PAINT) {
        PAINTSTRUCT paint{};
        BeginPaint(hwnd, &paint);
        EndPaint(hwnd, &paint);
        return 0;
    }
    return DefWindowProcW(hwnd, message, w, l);
}
void reset_capture() {
    g_dragFile.clear();
    if (!g_captureWindow) return;
    KillTimer(g_captureWindow, kCaptureTimeout);
    RevokeDragDrop(g_captureWindow);
    DestroyWindow(g_captureWindow);
    g_captureWindow = nullptr;
}

// Once the gesture is complete, establish a tiny, barely visible OLE target
// under the pointer. The Shell's existing drag loop delivers its *real*
// IDataObject on DragEnter. If there is no active OLE drag, nothing launches.
// This does not inject code into Explorer, suppress mouse-up, or replace a
// drop target during ordinary (non-shake) drag-and-drop.
void begin_capture(HWND source) {
    reset_capture();
    if (!source || !IsWindow(source) || !source_is_active(source) ||
        !g_requested) return;
    POINT pt{};
    if (!GetCursorPos(&pt)) return;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW cls{};
    cls.cbSize = sizeof(cls);
    cls.lpfnWndProc = capture_proc;
    cls.hInstance = instance;
    cls.lpszClassName = kCaptureClass;
    if (!RegisterClassExW(&cls) &&
        GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return;
    const int x = pt.x - kCaptureWidth / 2;
    const int y = pt.y - kCaptureWidth / 2;
    const HWND capture = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED | WS_EX_NOACTIVATE,
        kCaptureClass, L"", WS_POPUP,
        x, y, kCaptureWidth, kCaptureWidth,
        nullptr, nullptr, instance, nullptr);
    if (!capture) return;
    auto* sink = new(std::nothrow) DragCapture();
    if (!sink) { DestroyWindow(capture); return; }
    const HRESULT registered = RegisterDragDrop(capture, sink);
    sink->Release();
    if (FAILED(registered)) {
        DestroyWindow(capture);
        return;
    }
    g_captureWindow = capture;
    // Alpha 1/255 keeps the capture window visually negligible while still
    // participating in hit testing. Alpha zero is click-through on Windows.
    SetLayeredWindowAttributes(capture, RGB(0,0,0), 1, LWA_ALPHA);
    ShowWindow(capture, SW_SHOWNOACTIVATE);
    SetWindowPos(capture, HWND_TOPMOST, x, y,
        kCaptureWidth, kCaptureWidth, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetTimer(capture, kCaptureTimeout, 850, nullptr);
    // OLE may need a new pointer event to resolve the new drop target under
    // the cursor. A single synthetic 1px move is injected ONLY after a full
    // deliberate shake, never during ordinary drag/drop. No button event.
    INPUT input{};
    input.type = INPUT_MOUSE;
    input.mi.dx = 1;
    input.mi.dy = 0;
    input.mi.dwFlags = MOUSEEVENTF_MOVE;
    SendInput(1, &input, sizeof(INPUT));
}
bool cancel_verified_drag(HWND source) {
    if (!source_is_active(source)) return false;
    INPUT keys[2]{};
    keys[0].type = INPUT_KEYBOARD;
    keys[0].ki.wVk = VK_ESCAPE;
    keys[1].type = INPUT_KEYBOARD;
    keys[1].ki.wVk = VK_ESCAPE;
    keys[1].ki.dwFlags = KEYEVENTF_KEYUP;
    return SendInput(2, keys, sizeof(INPUT)) == 2;
}
void complete_capture() {
    const HWND source = g_source;
    const std::wstring file = g_dragFile;
    if (file.empty() || !source || !IsWindow(source)) {
        reset_capture();
        return;
    }
    // Cancel *only* a verified live OLE drag. ESC remains the documented
    // non-destructive cancel gesture in the Explorer drag loop.
    if (g_launch && cancel_verified_drag(source)) {
        reset_capture();
        g_launch(file.c_str());
    } else {
        reset_capture();
    }
}
} // namespace

extern "C" void reformany_stop_shake_listener() {
    HANDLE stop = OpenEventW(EVENT_MODIFY_STATE, FALSE, kStopName);
    if (stop) { SetEvent(stop); CloseHandle(stop); }
}
// When upgrading ReformANY, an older opt-in shake listener may still own
// the per-user mutex. Wait for its graceful stop before starting the new
// listener; otherwise the old selection-based implementation stays active.
extern "C" bool reformany_wait_shake_listener_exit(unsigned int timeout_ms) {
    HANDLE mutex = OpenMutexW(SYNCHRONIZE | MUTEX_MODIFY_STATE, FALSE, kMutexName);
    if (!mutex) return GetLastError() == ERROR_FILE_NOT_FOUND;
    const DWORD wait = WaitForSingleObject(mutex, timeout_ms);
    if (wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED) {
        ReleaseMutex(mutex);
        CloseHandle(mutex);
        return true;
    }
    CloseHandle(mutex);
    return false;
}
extern "C" bool reformany_reload_shake_listener() {
    HANDLE change = OpenEventW(EVENT_MODIFY_STATE, FALSE, kReloadName);
    if (!change) return false;
    const bool notified = SetEvent(change) != 0;
    CloseHandle(change);
    return notified;
}
extern "C" void reformany_win_shake_listen(Tick tick, Launch launch, Reload reload) {
    if (!tick || !launch || !reload) return;
    HANDLE mutex = CreateMutexW(nullptr, TRUE, kMutexName);
    if (!mutex) return;
    if (GetLastError() == ERROR_ALREADY_EXISTS) { CloseHandle(mutex); return; }
    HANDLE stop = CreateEventW(nullptr, TRUE, FALSE, kStopName);
    if (!stop) { ReleaseMutex(mutex); CloseHandle(mutex); return; }
    HANDLE changed = CreateEventW(nullptr, FALSE, FALSE, kReloadName);
    if (!changed) { CloseHandle(stop); ReleaseMutex(mutex); CloseHandle(mutex); return; }
    // RegisterDragDrop requires OleInitialize, not just CoInitializeEx.
    const HRESULT ole = OleInitialize(nullptr);
    if (FAILED(ole)) { CloseHandle(changed); CloseHandle(stop); ReleaseMutex(mutex); CloseHandle(mutex); return; }
    g_listenerThread = GetCurrentThreadId();
    g_tick = tick;
    g_launch = launch;
    g_reload = reload;
    MSG message{};
    PeekMessageW(&message, nullptr, 0, 0, PM_NOREMOVE);
    g_hook = SetWindowsHookExW(WH_MOUSE_LL, hook, GetModuleHandleW(nullptr), 0);
    if (g_hook) {
        while (true) {
            HANDLE events[2] = { stop, changed };
            const DWORD status = MsgWaitForMultipleObjects(
                2, events, FALSE, INFINITE, QS_ALLINPUT);
            if (status == WAIT_OBJECT_0 || status == WAIT_FAILED) break;
            if (status == WAIT_OBJECT_0 + 1) {
                if (g_reload) g_reload();
                continue;
            }
            if (status != WAIT_OBJECT_0 + 2) continue;
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                if (message.message == WM_QUIT) goto finish;
                if (message.hwnd == nullptr && message.message == kCaptureMsg) {
                    const HWND source = reinterpret_cast<HWND>(message.wParam);
                    if (source && source == g_source) begin_capture(source);
                } else if (message.hwnd == nullptr &&
                           message.message == kCapturedMsg) {
                    complete_capture();
                } else if (message.hwnd == nullptr &&
                           message.message == kResetMsg) {
                    reset_capture();
                } else {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
    }
finish:
    reset_capture();
    if (g_hook) { UnhookWindowsHookEx(g_hook); g_hook = nullptr; }
    g_tick = nullptr;
    g_launch = nullptr;
    g_reload = nullptr;
    g_source = nullptr;
    g_eligible = false;
    g_requested = false;
    g_listenerThread = 0;
    OleUninitialize();
    CloseHandle(changed);
    CloseHandle(stop);
    ReleaseMutex(mutex);
    CloseHandle(mutex);
}
