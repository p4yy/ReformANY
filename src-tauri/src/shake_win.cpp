// ReformANY native Explorer drag-gesture runtime.
//
// A 20ms polling loop (no WH_MOUSE_LL hook) reads the logical primary
// button via SM_SWAPBUTTON and GetAsyncKeyState. Rust owns the exact
// three-horizontal-reversal detector. The native listener is a separate
// opt-in STA process; the app's UI thread never polls or handles OLE.
//
// A completed shake is handled once BEFORE verifying a visible SysDragImage.
// Only then is an OLE drop target temporarily shown under the dragged cursor.
// The authoritative file is CF_HDROP from the actual IDataObject, never an
// Explorer selected-item snapshot. A verified DragEnter path is used for
// the cancellable 350ms release fallback, only when released over the target.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
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

namespace {
using Tick = unsigned char (*)(int,int,unsigned int,bool,bool,unsigned int);
using Launch = void (*)(const wchar_t*,unsigned char);
using Reload = void (*)();
using Validated = void (*)();
Tick g_tick=nullptr;
Launch g_launch=nullptr;
Reload g_reload=nullptr;
Validated g_validated=nullptr;

constexpr wchar_t kMutexName[]=L"Local\\ReformANY_OrbitShakeListener_1";
constexpr wchar_t kStopName[]=L"Local\\ReformANY_OrbitShakeStop_1";
constexpr wchar_t kReloadName[]=L"Local\\ReformANY_OrbitShakeReload_1";
constexpr wchar_t kPopupClass[]=L"ReformANY_OrbitShakeDropTarget";
constexpr UINT_PTR kReleaseTimer=0x68;
constexpr UINT_PTR kExpiryTimer=0x69;
constexpr UINT kPublishMsg=WM_APP+0x6a;
constexpr int kDiameter=340;
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
    const int physical=GetSystemMetrics(SM_SWAPBUTTON)?VK_RBUTTON:VK_LBUTTON;
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
unsigned char tab_under_pointer(POINT position){
    if(!g_target)return 0;
    RECT bounds{};
    if(!GetWindowRect(g_target,&bounds))return 0;
    const long x=position.x-(bounds.left+kRadius);
    const long y=position.y-(bounds.top+kRadius);
    // Upper semicircle = Convert. Lower-left = Tools; lower-right = Actions.
    return y>25?(x<0?1:2):0;
}
void draw_text(HDC dc,int left,int top,int right,int bottom,
    const wchar_t* value,int size,COLORREF color,bool bold=false){
    LOGFONTW definition{};
    definition.lfHeight=-size;
    definition.lfWeight=bold?FW_SEMIBOLD:FW_NORMAL;
    wcscpy_s(definition.lfFaceName,L"Segoe UI");
    HFONT font=CreateFontIndirectW(&definition);
    HGDIOBJ old=SelectObject(dc,font);
    SetTextColor(dc,color);
    SetBkMode(dc,TRANSPARENT);
    RECT box{left,top,right,bottom};
    DrawTextW(dc,value,-1,&box,DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX);
    SelectObject(dc,old);
    DeleteObject(font);
}
void paint_popup(HWND hwnd){
    PAINTSTRUCT ps{};
    HDC dc=BeginPaint(hwnd,&ps);
    RECT client{};
    GetClientRect(hwnd,&client);
    HBRUSH background=CreateSolidBrush(RGB(25,34,25));
    FillRect(dc,&client,background);
    DeleteObject(background);
    HPEN border=CreatePen(PS_SOLID,3,RGB(148,169,120));
    HGDIOBJ oldPen=SelectObject(dc,border);
    HGDIOBJ oldBrush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));
    Ellipse(dc,7,7,kDiameter-7,kDiameter-7);
    Ellipse(dc,106,106,kDiameter-106,kDiameter-106);
    MoveToEx(dc,0,205,nullptr);
    LineTo(dc,105,205);
    MoveToEx(dc,235,205,nullptr);
    LineTo(dc,kDiameter,205);
    SelectObject(dc,oldBrush);
    SelectObject(dc,oldPen);
    DeleteObject(border);
    draw_text(dc,55,35,285,65,L"CONVERT",18,RGB(215,229,188),g_tab==0);
    draw_text(dc,20,242,167,279,L"TOOLS",17,RGB(214,223,193),g_tab==1);
    draw_text(dc,171,242,320,279,L"ACTIONS",17,RGB(214,223,193),g_tab==2);
    draw_text(dc,92,139,248,173,L"Drop file",17,RGB(243,247,232),true);
    draw_text(dc,91,171,250,189,L"to open Orbit",11,RGB(196,210,169));
    EndPaint(hwnd,&ps);
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
    const unsigned char section=g_tab;
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
        const DWORD requested=*effect;
        *effect=DROPEFFECT_NONE;
        std::wstring path;
        if(source_active(g_source)&&exact_single_file(data,path)){
            g_dragEnterPath=std::move(path);
            active_=true;
            const POINT position{point.x,point.y};
            g_tab=tab_under_pointer(position);
            if(requested&DROPEFFECT_COPY)*effect=DROPEFFECT_COPY;
            if(g_target)InvalidateRect(g_target,nullptr,FALSE);
        }else{
            active_=false;
            g_dragEnterPath.clear();
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragOver(DWORD,POINTL point,DWORD* effect) override{
        if(!effect)return E_INVALIDARG;
        const DWORD requested=*effect;
        *effect=active_&&(requested&DROPEFFECT_COPY)?DROPEFFECT_COPY:DROPEFFECT_NONE;
        const POINT position{point.x,point.y};
        const auto section=tab_under_pointer(position);
        if(section!=g_tab){
            g_tab=section;
            if(g_target)InvalidateRect(g_target,nullptr,FALSE);
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragLeave() override{
        active_=false;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Drop(IDataObject* data,DWORD,POINTL point,
        DWORD* effect) override{
        if(!effect)return E_INVALIDARG;
        const DWORD allowed=*effect;
        *effect=DROPEFFECT_NONE;
        g_dropped=true;
        g_invalidDrop=true;
        g_dropPath.clear();
        std::wstring actual;
        const POINT position{point.x,point.y};
        if((allowed&DROPEFFECT_COPY)&&inside_circle(position)
            &&exact_single_file(data,actual)){
            // This is the authoritative dropped file, not the Shell selection.
            g_dropPath=std::move(actual);
            g_tab=tab_under_pointer(position);
            g_invalidDrop=false;
            *effect=DROPEFFECT_COPY;
            PostThreadMessageW(g_listenerThread,kPublishMsg,1,0);
        }else{
            // An invalid / multi-file Drop must never fall back to a cached
            // DragEnter selection, even if that older object was valid.
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
    if(message==WM_TIMER&&w==kExpiryTimer){reset_target();return 0;}
    if(message==WM_TIMER&&w==kReleaseTimer){
        // Do not guess from the selected files in Explorer. A fallback is
        // legal only when this exact drag previously supplied CF_HDROP,
        // the user released over our visible circle, and no Drop arrived.
        if(g_released&&!g_dropped&&!g_invalidDrop&&
            g_hasReleasePoint&&inside_circle(g_releasePoint)
            &&!g_dragEnterPath.empty()){
            g_tab=tab_under_pointer(g_releasePoint);
            finish_with_file(false);
        }else{reset_target();}
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
    cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);
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
    SetLayeredWindowAttributes(hwnd,RGB(0,0,0),238,LWA_ALPHA);
    ShowWindow(hwnd,SW_SHOWNOACTIVATE);
    SetWindowPos(hwnd,HWND_TOPMOST,pt.x-kRadius,pt.y-kRadius,
        kDiameter,kDiameter,SWP_SHOWWINDOW|SWP_NOACTIVATE);
    SetTimer(hwnd,kExpiryTimer,7000,nullptr);
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
    }
    const int dragThreshold=std::max(1,GetSystemMetrics(SM_CXDRAG));
    const auto phase=g_tick(pt.x,pt.y,timestamp,true,g_eligible,
        static_cast<unsigned int>(dragThreshold));
    if(phase==2&&!g_handled){
        g_handled=true; // no repeat even if the SysDragImage check fails.
        if(!g_eligible||!source_active(g_source)||!visible_shell_drag_image())
            return;
        if(g_validated)g_validated();
        show_drop_target();
    }
}
} // namespace

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
    Tick tick,Launch launch,Reload reload,Validated validated){
    if(!tick||!launch||!reload||!validated)return;
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
    MSG message{};
    PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);
    // Thread timers ignore an unallocated requested ID. Use the actual
    // ID returned by SetTimer, otherwise polling never executes.
    const UINT_PTR polling=SetTimer(nullptr,0,kPollMs,nullptr);
    if(polling){
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
                }else if(!message.hwnd&&message.message==kPublishMsg){
                    if(message.wParam==1&&!g_dropPath.empty()){
                        finish_with_file(true);
                    }else{reset_target();}
                }else{
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
    }
shutdown:
    if(polling)KillTimer(nullptr,polling);
    reset_target();
    g_tick=nullptr;
    g_launch=nullptr;
    g_reload=nullptr;
    g_validated=nullptr;
    g_source=nullptr;
    g_eligible=false;
    g_handled=false;
    g_wasDown=false;
    g_listenerThread=0;
    OleUninitialize();
    CloseHandle(changed);CloseHandle(stop);
    ReleaseMutex(mutex);CloseHandle(mutex);
}
