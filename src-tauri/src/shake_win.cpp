// ReformANY native Explorer drag-gesture runtime.
//
// A 20ms polling loop (no WH_MOUSE_LL hook) reads the logical primary
// button via SM_SWAPBUTTON and GetAsyncKeyState. Rust owns the exact
// three-horizontal-reversal detector. The native listener is a separate
// opt-in STA process; the app's UI thread never polls or handles OLE.
//
// A completed shake is handled once BEFORE verifying a visible SysDragImage.
// Only then a near-invisible OLE capture target receives the active
// IDataObject. A verified DragEnter immediately cancels Explorer's drag
// non-destructively (Esc) and launches the REAL Convert Orbit: NO intermediate
// Convert/Tools/Actions menu, and NO additional drop/release step.
// Drop/release is retained only as a conservative fallback if cancellation
// could not complete. Explorer's selected-item snapshot is never trusted.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>
#include <thread>
#include <cstdint>
#include <ole2.h>
#include <shellapi.h>
#include <objidl.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cwchar>
#include <new>
#include <string>
#include <vector>

extern "C" unsigned int reformany_native_primary_button_vk(int swapped);
extern "C" unsigned int reformany_native_poll_interval_ms();
extern "C" unsigned int reformany_native_fallback_ms();

namespace {
using Tick = unsigned char (*)(int,int,unsigned int,bool,bool,unsigned int);
using Launch = void (*)(const wchar_t*,unsigned char);
using Reload = void (*)();
using Validated = void (*)();
using Trace = void (*)(unsigned char);
Tick g_tick=nullptr;
Launch g_launch=nullptr;
Reload g_reload=nullptr;
Validated g_validated=nullptr;
Trace g_trace=nullptr;

constexpr wchar_t kMutexName[]=L"Local\\ReformANY_OrbitShakeListener_1";
constexpr wchar_t kStopName[]=L"Local\\ReformANY_OrbitShakeStop_1";
constexpr wchar_t kReloadName[]=L"Local\\ReformANY_OrbitShakeReload_1";
constexpr wchar_t kPopupClass[]=L"ReformANY_OrbitShakeDropTarget";
constexpr UINT_PTR kReleaseTimer=0x68;
constexpr UINT_PTR kExpiryTimer=0x69;
constexpr UINT kPublishMsg=WM_APP+0x6a;
constexpr UINT kTraceMsg=WM_APP+0x6b;
constexpr int kDiameter=148;
constexpr int kRadius=kDiameter/2;
constexpr unsigned int kFallbackMs=350;
constexpr unsigned int kPollMs=20;

HWND g_source=nullptr;
HWND g_target=nullptr;
bool g_wasDown=false;
bool g_eligible=false;
bool g_handled=false;
bool g_released=false;
bool g_dropped=false;
bool g_invalidDrop=false;
bool g_hasReleasePoint=false;
POINT g_releasePoint{};
std::wstring g_dragEnterPath;
std::wstring g_dropPath;
unsigned char g_tab=0;
DWORD g_listenerThread=0;

void trace_stage(unsigned char stage){
    if(g_listenerThread)PostThreadMessageW(g_listenerThread,kTraceMsg,stage,0);
}
bool class_is(HWND window,const wchar_t* name){
    if(!window)return false;
    wchar_t value[128]{};
    return GetClassNameW(window,value,128)>0&&wcscmp(value,name)==0;
}
bool shell_root(HWND root){
    return class_is(root,L"CabinetWClass")||class_is(root,L"ExploreWClass")||
           class_is(root,L"Progman")||class_is(root,L"WorkerW")||
           root==GetShellWindow();
}
bool shell_file_area(HWND child,HWND root){
    if(!shell_root(root))return false;
    for(HWND item=child;item&&item!=root;item=GetParent(item)){
        if(class_is(item,L"Edit")||class_is(item,L"ToolbarWindow32")||
           class_is(item,L"SearchBox"))return false;
        if(class_is(item,L"SHELLDLL_DefView")||
           class_is(item,L"SysListView32")||
           class_is(item,L"DirectUIHWND")||
           class_is(item,L"ItemsView"))return true;
    }
    return root==GetShellWindow()||class_is(root,L"Progman");
}
bool primary_held(){
    // GetAsyncKeyState always reports PHYSICAL buttons. VK_RBUTTON is the
    // primary button if the user swapped Windows' logical button mapping.
    const int physical=static_cast<int>(reformany_native_primary_button_vk(GetSystemMetrics(SM_SWAPBUTTON)));
    return (GetAsyncKeyState(physical)&0x8000)!=0;
}
bool source_active(HWND source){
    if(!source||!IsWindow(source)||!primary_held())return false;
    HWND foreground=GetForegroundWindow();
    if(foreground)foreground=GetAncestor(foreground,GA_ROOT);
    if(foreground==source)return true;
    // Explorer Desktop is hosted by Progman/WorkerW; it can have another
    // Shell top-level window in the foreground during the original drag.
    return shell_root(source)&&shell_root(foreground)&&
        (class_is(source,L"Progman")||class_is(source,L"WorkerW")||
         source==GetShellWindow());
}
bool visible_shell_drag_image(){
    // One query per physical hold, after Rust has marked ShakeDetected as
    // handled. If missing, the same hold may never try again.
    const HWND image=FindWindowW(L"SysDragImage",nullptr);
    return image&&IsWindow(image)&&IsWindowVisible(image);
}
bool exact_single_file(IDataObject* data,std::wstring& result){
    result.clear();
    if(!data)return false;
    FORMATETC format{CF_HDROP,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};
    STGMEDIUM medium{};
    if(FAILED(data->GetData(&format,&medium)))return false;
    bool valid=false;
    const HDROP handle=reinterpret_cast<HDROP>(medium.hGlobal);
    if(handle&&DragQueryFileW(handle,0xffffffff,nullptr,0)==1){
        const UINT n=DragQueryFileW(handle,0,nullptr,0);
        if(n>0&&n<32760){
            std::vector<wchar_t> buffer(static_cast<size_t>(n)+1,0);
            if(DragQueryFileW(handle,0,buffer.data(),n+1)==n){
                const DWORD attributes=GetFileAttributesW(buffer.data());
                if(attributes!=INVALID_FILE_ATTRIBUTES&&
                   (attributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))==0){
                    result.assign(buffer.data(),n);
                    valid=true;
                }
            }
        }
    }
    ReleaseStgMedium(&medium);
    return valid;
}
bool inside_circle(POINT position){
    if(!g_target)return false;
    RECT bounds{};
    if(!GetWindowRect(g_target,&bounds))return false;
    const long dx=position.x-(bounds.left+kRadius);
    const long dy=position.y-(bounds.top+kRadius);
    return dx*dx+dy*dy<=kRadius*kRadius;
}
// No visible radial prompt or section selection exists in shake mode.
// The full Orbit application always opens on its default Convert screen.
void paint_popup(HWND hwnd){
    PAINTSTRUCT ps{};
    HDC dc=BeginPaint(hwnd,&ps);
    RECT rect{};GetClientRect(hwnd,&rect);
    HBRUSH brush=CreateSolidBrush(RGB(23,31,24));
    FillRect(dc,&rect,brush);
    DeleteObject(brush);
    EndPaint(hwnd,&ps);
}
bool cancel_verified_explorer_drag(){
    if(!source_active(g_source))return false;
    INPUT keyboard[2]{};
    keyboard[0].type=INPUT_KEYBOARD;
    keyboard[0].ki.wVk=VK_ESCAPE;
    keyboard[1].type=INPUT_KEYBOARD;
    keyboard[1].ki.wVk=VK_ESCAPE;
    keyboard[1].ki.dwFlags=KEYEVENTF_KEYUP;
    return SendInput(2,keyboard,sizeof(INPUT))==2;
}
void reset_target(){
    g_dragEnterPath.clear();
    g_dropPath.clear();
    g_dropped=false;
    g_invalidDrop=false;
    g_released=false;
    g_hasReleasePoint=false;
    g_tab=0;
    if(!g_target)return;
    KillTimer(g_target,kReleaseTimer);
    KillTimer(g_target,kExpiryTimer);
    RevokeDragDrop(g_target);
    DestroyWindow(g_target);
    g_target=nullptr;
}
void finish_with_file(bool actualDrop){
    if(!g_target)return;
    const std::wstring path=actualDrop?g_dropPath:g_dragEnterPath;
    constexpr unsigned char section=0; // Native shake always opens first Orbit section.
    reset_target();
    if(g_launch&&!path.empty())g_launch(path.c_str(),section);
}
class OrbitDragTarget final:public IDropTarget{
    std::atomic<ULONG> refs_{1};
    bool active_=false;
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void** result) override{
        if(!result)return E_POINTER;
        *result=nullptr;
        if(IsEqualIID(iid,IID_IUnknown)||IsEqualIID(iid,IID_IDropTarget)){
            *result=static_cast<IDropTarget*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs_;}
    ULONG STDMETHODCALLTYPE Release() override{
        const ULONG refs=--refs_;
        if(refs==0)delete this;
        return refs;
    }
    HRESULT STDMETHODCALLTYPE DragEnter(IDataObject* data,DWORD,POINTL point,
        DWORD* effect) override{
        if(!effect)return E_INVALIDARG;
        *effect=DROPEFFECT_NONE;
        std::wstring path;
        if(source_active(g_source)&&exact_single_file(data,path)){
            g_dragEnterPath=std::move(path);
            active_=true;
            trace_stage(7);
            // Prefer immediate entry: no visible three-choice action UI and
            // no wait for release. Drop is never required for a valid drag.
            PostThreadMessageW(g_listenerThread,kPublishMsg,2,0);
        }else{
            active_=false;
            g_dragEnterPath.clear();
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragOver(DWORD,POINTL,DWORD* effect) override{
        if(!effect)return E_INVALIDARG;
        // Never promise a copy/move; shake is a command, not a file transfer.
        *effect=DROPEFFECT_NONE;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragLeave() override{
        active_=false;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Drop(IDataObject* data,DWORD,POINTL point,
        DWORD* effect) override{
        if(!effect)return E_INVALIDARG;
        *effect=DROPEFFECT_NONE;
        g_dropped=true;
        g_invalidDrop=true;
        g_dropPath.clear();
        std::wstring actual;
        const POINT position{point.x,point.y};
        if(inside_circle(position)&&exact_single_file(data,actual)){
            // This is the authoritative dropped file, not the Shell selection.
            g_dropPath=std::move(actual);
            g_invalidDrop=false;
            trace_stage(8);
            PostThreadMessageW(g_listenerThread,kPublishMsg,1,0);
        }else{
            // An invalid / multi-file Drop must never fall back to a cached
            // DragEnter selection, even if that older object was valid.
            trace_stage(9);
            PostThreadMessageW(g_listenerThread,kPublishMsg,0,0);
        }
        active_=false;
        return S_OK;
    }
};
LRESULT CALLBACK popup_proc(HWND hwnd,UINT message,WPARAM w,LPARAM l){
    if(message==WM_NCHITTEST)return HTCLIENT;
    if(message==WM_MOUSEACTIVATE)return MA_NOACTIVATE;
    if(message==WM_PAINT){paint_popup(hwnd);return 0;}
    if(message==WM_ERASEBKGND)return 1;
    if(message==WM_TIMER&&w==kExpiryTimer){trace_stage(12);reset_target();return 0;}
    if(message==WM_TIMER&&w==kReleaseTimer){
        // Do not guess from the selected files in Explorer. A fallback is
        // legal only when this exact drag previously supplied CF_HDROP,
        // the user released over our visible circle, and no Drop arrived.
        if(g_released&&!g_dropped&&!g_invalidDrop&&
            g_hasReleasePoint&&inside_circle(g_releasePoint)
            &&!g_dragEnterPath.empty()){
            trace_stage(10);
            finish_with_file(false);
        }else{trace_stage(11);reset_target();}
        return 0;
    }
    return DefWindowProcW(hwnd,message,w,l);
}
bool show_drop_target(){
    if(g_target||!source_active(g_source))return false;
    POINT pt{};
    if(!GetCursorPos(&pt))return false;
    const HINSTANCE instance=GetModuleHandleW(nullptr);
    WNDCLASSEXW cls{};
    cls.cbSize=sizeof(cls);
    cls.lpfnWndProc=popup_proc;
    cls.hInstance=instance;
    cls.lpszClassName=kPopupClass;
    cls.hCursor=LoadCursorW(nullptr,MAKEINTRESOURCEW(32512));
    if(!RegisterClassExW(&cls)&&GetLastError()!=ERROR_CLASS_ALREADY_EXISTS)
        return false;
    const HWND hwnd=CreateWindowExW(
        WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_LAYERED|WS_EX_NOACTIVATE,
        kPopupClass,L"ReformANY Orbit",WS_POPUP,
        pt.x-kRadius,pt.y-kRadius,kDiameter,kDiameter,
        nullptr,nullptr,instance,nullptr);
    if(!hwnd)return false;
    auto* target=new(std::nothrow) OrbitDragTarget();
    if(!target){DestroyWindow(hwnd);return false;}
    const HRESULT result=RegisterDragDrop(hwnd,target);
    target->Release();
    if(FAILED(result)){DestroyWindow(hwnd);return false;}
    g_target=hwnd;
    SetWindowRgn(hwnd,CreateEllipticRgn(0,0,kDiameter,kDiameter),TRUE);
    // Tiny OLE hit target, practically invisible: no toolbar, labels, or
    // action wheel can appear between the gesture and the real Orbit.
    SetLayeredWindowAttributes(hwnd,RGB(0,0,0),5,LWA_ALPHA);
    ShowWindow(hwnd,SW_SHOWNOACTIVATE);
    SetWindowPos(hwnd,HWND_TOPMOST,pt.x-kRadius,pt.y-kRadius,
        kDiameter,kDiameter,SWP_SHOWWINDOW|SWP_NOACTIVATE);
    SetTimer(hwnd,kExpiryTimer,1600,nullptr);
    // One harmless relative pointer event lets the existing Explorer OLE
    // loop resolve the newly registered target. Never send button/ESC input.
    INPUT input{};
    input.type=INPUT_MOUSE;
    input.mi.dx=1;
    input.mi.dwFlags=MOUSEEVENTF_MOVE;
    SendInput(1,&input,sizeof(INPUT));
    return true;
}
void poll_mouse(){
    if(!g_tick)return;
    POINT pt{};
    if(!GetCursorPos(&pt)){
        if(g_wasDown){g_wasDown=false;g_tick(0,0,GetTickCount(),false,false,0);}
        return;
    }
    const bool held=primary_held();
    const DWORD timestamp=GetTickCount();
    if(!held){
        if(g_wasDown){
            g_wasDown=false;
            g_tick(pt.x,pt.y,timestamp,false,false,0);
            g_released=true;
            g_releasePoint=pt;
            g_hasReleasePoint=true;
            if(g_target&&!g_dropped){
                SetTimer(g_target,kReleaseTimer,kFallbackMs,nullptr);
            }
        }
        return;
    }
    if(!g_wasDown){
        g_wasDown=true;
        g_handled=false;
        reset_target();
        const HWND under=WindowFromPoint(pt);
        const HWND root=under?GetAncestor(under,GA_ROOT):nullptr;
        g_eligible=shell_file_area(under,root);
        g_source=g_eligible?root:nullptr;
        // Some builds display SysDragImage before the first 20ms sample;
        // still require that Explorer is the foreground source.
        if(!g_eligible&&visible_shell_drag_image()){
            HWND foreground=GetForegroundWindow();
            if(foreground)foreground=GetAncestor(foreground,GA_ROOT);
            if(shell_root(foreground)){g_eligible=true;g_source=foreground;}
        }
        if(g_eligible)trace_stage(2);
    }
    const int dragThreshold=std::max(1,GetSystemMetrics(SM_CXDRAG));
    const auto phase=g_tick(pt.x,pt.y,timestamp,true,g_eligible,
        static_cast<unsigned int>(dragThreshold));
    if(phase==2&&!g_handled){
        g_handled=true; // no repeat even if the SysDragImage check fails.
        trace_stage(3);
        if(!g_eligible||!source_active(g_source)||!visible_shell_drag_image()){
            trace_stage(4);
            return;
        }
        trace_stage(5);
        if(g_validated)g_validated();
        if(show_drop_target())trace_stage(6);
        else trace_stage(14);
    }
}
} // namespace

// Original, restrained opening cue: 205ms of soft filtered air and a warm
// descending tone. Synthesized entirely in memory, with no asset download,
// shell pop-up or file I/O. The audio plays on a detached thread only AFTER
// the real Orbit process successfully spawned. SND_SYNC is required when
// PlaySound is handed a memory WAVE; never block the Win32 drag event loop.
extern "C" void reformany_play_orbit_open_sound(float volume){
    if(!(volume>0.0f))return;
    const float safe=std::clamp(volume,0.0f,1.0f);
    std::thread([safe](){
        constexpr unsigned int rate=44100;
        constexpr unsigned int ms=205;
        constexpr unsigned int frames=rate*ms/1000;
        constexpr double pi=3.14159265358979323846;
        std::vector<unsigned char> wav(44+frames*2,0);
        const auto u16=[&wav](size_t offset,unsigned int v){
            wav[offset]=static_cast<unsigned char>(v&255);
            wav[offset+1]=static_cast<unsigned char>((v>>8)&255);
        };
        const auto u32=[&wav](size_t offset,unsigned int v){
            for(int i=0;i<4;i++)
                wav[offset+i]=static_cast<unsigned char>((v>>(i*8))&255);
        };
        auto tag=[&wav](size_t offset,const char* chars){
            for(int i=0;i<4;i++)wav[offset+i]=static_cast<unsigned char>(chars[i]);
        };
        tag(0,"RIFF");u32(4,static_cast<unsigned int>(wav.size()-8));
        tag(8,"WAVE");tag(12,"fmt ");u32(16,16);
        u16(20,1);u16(22,1);u32(24,rate);u32(28,rate*2);
        u16(32,2);u16(34,16);tag(36,"data");u32(40,frames*2);
        uint32_t seed=0x9e3779b9;
        double filteredNoise=0.0;
        double phase=0.0;
        for(unsigned int i=0;i<frames;i++){
            const double t=static_cast<double>(i)/rate;
            const double progress=static_cast<double>(i)/frames;
            const double attack=std::min(1.0,t/0.009);
            const double tail=std::pow(1.0-progress,2.45);
            const double envelope=attack*tail;
            // Very modest downward sweep, never an alert/notification beep.
            const double frequency=465.0-125.0*progress;
            phase+=2.0*pi*frequency/rate;
            seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;
            const double white=static_cast<double>(seed&65535)/32767.5-1.0;
            filteredNoise=0.86*filteredNoise+0.14*white;
            const double air=filteredNoise*(0.70+0.30*progress);
            const double body=0.55*std::sin(phase)+0.09*std::sin(2.0*phase);
            const double sample=(body+0.30*air)*envelope*
                (0.092*static_cast<double>(safe));
            const int value=static_cast<int>(std::lround(
                std::clamp(sample,-1.0,1.0)*32767.0));
            u16(44+2*i,static_cast<unsigned int>(static_cast<uint16_t>(value)));
        }
        PlaySoundW(reinterpret_cast<LPCWSTR>(wav.data()),nullptr,
            SND_MEMORY|SND_SYNC|SND_NODEFAULT);
    }).detach();
}
extern "C" unsigned int reformany_native_open_sound_duration_ms(){return 205;}

extern "C" unsigned int reformany_native_primary_button_vk(int swapped){
    return swapped?VK_RBUTTON:VK_LBUTTON;
}
extern "C" unsigned int reformany_native_poll_interval_ms(){return kPollMs;}
extern "C" unsigned int reformany_native_fallback_ms(){return kFallbackMs;}

extern "C" void reformany_stop_shake_listener(){
    HANDLE stop=OpenEventW(EVENT_MODIFY_STATE,FALSE,kStopName);
    if(stop){SetEvent(stop);CloseHandle(stop);}
}
extern "C" bool reformany_wait_shake_listener_exit(unsigned int timeout_ms){
    HANDLE mutex=OpenMutexW(SYNCHRONIZE|MUTEX_MODIFY_STATE,FALSE,kMutexName);
    if(!mutex)return GetLastError()==ERROR_FILE_NOT_FOUND;
    const DWORD waited=WaitForSingleObject(mutex,timeout_ms);
    if(waited==WAIT_OBJECT_0||waited==WAIT_ABANDONED){
        ReleaseMutex(mutex);
        CloseHandle(mutex);
        return true;
    }
    CloseHandle(mutex);
    return false;
}
extern "C" bool reformany_reload_shake_listener(){
    HANDLE changed=OpenEventW(EVENT_MODIFY_STATE,FALSE,kReloadName);
    if(!changed)return false;
    const bool signaled=SetEvent(changed)!=0;
    CloseHandle(changed);
    return signaled;
}
extern "C" void reformany_win_shake_listen(
    Tick tick,Launch launch,Reload reload,Validated validated,Trace trace){
    if(!tick||!launch||!reload||!validated||!trace)return;
    HANDLE mutex=CreateMutexW(nullptr,TRUE,kMutexName);
    if(!mutex)return;
    if(GetLastError()==ERROR_ALREADY_EXISTS){CloseHandle(mutex);return;}
    HANDLE stop=CreateEventW(nullptr,TRUE,FALSE,kStopName);
    if(!stop){ReleaseMutex(mutex);CloseHandle(mutex);return;}
    HANDLE changed=CreateEventW(nullptr,FALSE,FALSE,kReloadName);
    if(!changed){CloseHandle(stop);ReleaseMutex(mutex);CloseHandle(mutex);return;}
    const HRESULT ole=OleInitialize(nullptr);
    if(FAILED(ole)){
        CloseHandle(changed);CloseHandle(stop);
        ReleaseMutex(mutex);CloseHandle(mutex);return;
    }
    g_listenerThread=GetCurrentThreadId();
    g_tick=tick;
    g_launch=launch;
    g_reload=reload;
    g_validated=validated;
    g_trace=trace;
    MSG message{};
    PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);
    // Thread timers ignore an unallocated requested ID. Use the actual
    // ID returned by SetTimer, otherwise polling never executes.
    const UINT_PTR polling=SetTimer(nullptr,0,kPollMs,nullptr);
    if(polling){
        trace_stage(1);
        HANDLE events[2]={stop,changed};
        while(true){
            const DWORD status=MsgWaitForMultipleObjects(2,events,FALSE,
                INFINITE,QS_ALLINPUT);
            if(status==WAIT_OBJECT_0||status==WAIT_FAILED)break;
            if(status==WAIT_OBJECT_0+1){
                reset_target();
                g_wasDown=false;
                g_handled=false;
                g_tick(0,0,GetTickCount(),false,false,0);
                if(g_reload)g_reload();
                continue;
            }
            if(status!=WAIT_OBJECT_0+2)continue;
            while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){
                if(message.message==WM_QUIT)goto shutdown;
                if(!message.hwnd&&message.message==WM_TIMER&&
                   message.wParam==polling){
                    poll_mouse();
                }else if(!message.hwnd&&message.message==kTraceMsg){
                    if(g_trace)g_trace(static_cast<unsigned char>(message.wParam));
                }else if(!message.hwnd&&message.message==kPublishMsg){
                    if(message.wParam==2&&!g_dragEnterPath.empty()){
                        // The exact file was delivered by live IDataObject.
                        // Esc cancels Explorer's source drag, so a subsequent
                        // mouse release cannot accidentally move/copy it.
                        // Only launch if cancellation was accepted by Windows.
                        if(cancel_verified_explorer_drag()){
                            trace_stage(15); // opened directly on verified DragEnter
                            finish_with_file(false);
                        }
                        // If Esc was denied, leave the small hidden target
                        // until Drop or the bounded release fallback.
                    }else if(message.wParam==1&&!g_dropPath.empty()){
                        finish_with_file(true);
                    }else if(message.wParam==0){reset_target();}
                }else{
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
    }
shutdown:
    if(g_trace)g_trace(13);
    if(polling)KillTimer(nullptr,polling);
    reset_target();
    g_tick=nullptr;
    g_launch=nullptr;
    g_reload=nullptr;
    g_validated=nullptr;
    g_trace=nullptr;
    g_source=nullptr;
    g_eligible=false;
    g_handled=false;
    g_wasDown=false;
    g_listenerThread=0;
    OleUninitialize();
    CloseHandle(changed);CloseHandle(stop);
    ReleaseMutex(mutex);CloseHandle(mutex);
}
