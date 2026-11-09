// Native Windows Shell gesture receiver for ReformANY.
// Deliberately never opens a file merely from mouse motion: a valid
// IShellView selection IDataObject containing CF_HDROP paths is mandatory.
// The low-level hook performs only O(1) work. COM lookup happens AFTER the
// gesture, in the listener's own STA message loop, not inside the hook.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlguid.h>
#include <exdisp.h>
#include <servprov.h>
#include <objidl.h>
#include <cwchar>
#include <vector>
#include <string>

namespace {
using Tick = bool (*)(int,int,unsigned int,bool,bool);
using Launch = void (*)(const wchar_t *);
Tick g_tick=nullptr;
Launch g_launch=nullptr;
HHOOK g_hook=nullptr;
HWND g_source=nullptr;
bool g_down=false;
bool g_eligible=false;
constexpr UINT kGestureMsg=WM_APP+0x52;
constexpr wchar_t kMutexName[]=L"Local\\ReformANY_OrbitShakeListener_1";
constexpr wchar_t kStopName[]=L"Local\\ReformANY_OrbitShakeStop_1";

bool class_is(HWND hwnd,const wchar_t* cls){
    if(!hwnd)return false;
    wchar_t actual[128]{};
    return GetClassNameW(hwnd,actual,128)>0&&wcscmp(actual,cls)==0;
}
bool is_shell_window(HWND root){
    return class_is(root,L"CabinetWClass")||class_is(root,L"ExploreWClass")||
        class_is(root,L"Progman")||class_is(root,L"WorkerW")||root==GetShellWindow();
}
bool is_shell_items_area(HWND child,HWND root){
    if(!is_shell_window(root))return false;
    for(HWND test=child;test&&test!=root;test=GetParent(test)){
        if(class_is(test,L"SHELLDLL_DefView")||class_is(test,L"SysListView32")||
           class_is(test,L"DirectUIHWND")||class_is(test,L"ItemsView"))
            return true;
        if(class_is(test,L"Edit")||class_is(test,L"ToolbarWindow32")||
           class_is(test,L"SearchBox"))return false;
    }
    return false;
}
LRESULT CALLBACK hook(int code,WPARAM kind,LPARAM info){
    if(code<0||!g_tick)return CallNextHookEx(g_hook,code,kind,info);
    const auto* sample=reinterpret_cast<const MSLLHOOKSTRUCT*>(info);
    if(!sample)return CallNextHookEx(g_hook,code,kind,info);
    if(kind==WM_LBUTTONDOWN){
        const HWND child=WindowFromPoint(sample->pt);
        const HWND root=child?GetAncestor(child,GA_ROOT):nullptr;
        // Only track a shell file-list mouse down. Toolbar/shake anywhere
        // else must NEVER query selected shell files or trigger Orbit.
        g_eligible=is_shell_items_area(child,root);
        g_source=g_eligible?root:nullptr;
        g_down=true;
        g_tick(sample->pt.x,sample->pt.y,sample->time,true,g_eligible);
    }else if(kind==WM_LBUTTONUP){
        g_down=false;g_eligible=false;g_source=nullptr;
        g_tick(sample->pt.x,sample->pt.y,sample->time,false,false);
    }else if(kind==WM_MOUSEMOVE&&g_down){
        bool held=(GetAsyncKeyState(VK_LBUTTON)&0x8000)!=0;
        if(g_tick(sample->pt.x,sample->pt.y,sample->time,held,g_eligible)&&held&&g_source){
            // Return to the native drag loop immediately. Shell IDataObject
            // retrieval can be expensive and must not delay the hook callback.
            PostThreadMessageW(GetCurrentThreadId(),kGestureMsg,
                reinterpret_cast<WPARAM>(g_source),0);
            g_eligible=false;
        }
    }
    return CallNextHookEx(g_hook,code,kind,info);
}
bool selected_from_browser(IShellBrowser* browser,HWND source){
    HWND window=nullptr;
    if(!browser||FAILED(browser->GetWindow(&window))||!window)return false;
    HWND root=GetAncestor(window,GA_ROOT);
    const bool desktop=is_shell_window(source)&&
        (class_is(source,L"Progman")||class_is(source,L"WorkerW")||
         source==GetShellWindow());
    if(root!=source&&!desktop)return false;
    IShellView* view=nullptr;
    if(FAILED(browser->QueryActiveShellView(&view))||!view)return false;
    IDataObject* data=nullptr;
    HRESULT result=view->GetItemObject(SVGIO_SELECTION,IID_IDataObject,
        reinterpret_cast<void**>(&data));
    view->Release();
    if(FAILED(result)||!data)return false;
    FORMATETC format={CF_HDROP,nullptr,DVASPECT_CONTENT,-1,TYMED_HGLOBAL};
    STGMEDIUM medium{};
    result=data->GetData(&format,&medium);
    data->Release();
    if(FAILED(result))return false;
    bool launched=false;
    const HDROP files=reinterpret_cast<HDROP>(medium.hGlobal);
    const UINT count=DragQueryFileW(files,0xFFFFFFFF,nullptr,0);
    // Never guess non-filesystem shell names. Avoid multiple Orbit instances:
    // batch gestures need a distinct selected-files workflow before release.
    if(count>=1&&count<=128){
        const UINT needed=DragQueryFileW(files,0,nullptr,0);
        if(needed>0&&needed<32760){
            std::vector<wchar_t> path(static_cast<size_t>(needed)+1,0);
            if(DragQueryFileW(files,0,path.data(),needed+1)>0){
                const DWORD attrs=GetFileAttributesW(path.data());
                if(attrs!=INVALID_FILE_ATTRIBUTES&&!(attrs&FILE_ATTRIBUTE_REPARSE_POINT)){
                    if(g_launch){g_launch(path.data());launched=true;}
                }
            }
        }
    }
    ReleaseStgMedium(&medium);
    return launched;
}
bool locate_shell_data(HWND source){
    IShellWindows* all=nullptr;
    if(FAILED(CoCreateInstance(CLSID_ShellWindows,nullptr,CLSCTX_LOCAL_SERVER,
        IID_IShellWindows,reinterpret_cast<void**>(&all)))||!all)return false;
    long count=0;
    if(FAILED(all->get_Count(&count))){all->Release();return false;}
    bool launched=false;
    for(long i=0;i<count&&!launched;i++){
        VARIANT index{};
        VariantInit(&index);index.vt=VT_I4;index.lVal=i;
        IDispatch* dispatch=nullptr;
        const HRESULT item=all->Item(index,&dispatch);
        VariantClear(&index);
        if(FAILED(item)||!dispatch)continue;
        IServiceProvider* provider=nullptr;
        IShellBrowser* browser=nullptr;
        if(SUCCEEDED(dispatch->QueryInterface(IID_IServiceProvider,
               reinterpret_cast<void**>(&provider)))&&provider){
            provider->QueryService(SID_STopLevelBrowser,IID_IShellBrowser,
                reinterpret_cast<void**>(&browser));
            provider->Release();
        }
        dispatch->Release();
        if(browser){
            launched=selected_from_browser(browser,source);
            browser->Release();
        }
    }
    // Desktop's shell browser may be absent from normal Item enumeration.
    if(!launched&&(class_is(source,L"Progman")||class_is(source,L"WorkerW")||
                   source==GetShellWindow())){
        VARIANT missing{};
        VariantInit(&missing);
        IDispatch* desktop=nullptr;
        long hwnd=0;
        if(SUCCEEDED(all->FindWindowSW(&missing,&missing,SWC_DESKTOP,&hwnd,
            SWFO_NEEDDISPATCH,&desktop))&&desktop){
            IServiceProvider* provider=nullptr;
            IShellBrowser* browser=nullptr;
            if(SUCCEEDED(desktop->QueryInterface(IID_IServiceProvider,
                reinterpret_cast<void**>(&provider)))&&provider){
                provider->QueryService(SID_STopLevelBrowser,IID_IShellBrowser,
                    reinterpret_cast<void**>(&browser));
                provider->Release();
            }
            desktop->Release();
            if(browser){
                launched=selected_from_browser(browser,source);
                browser->Release();
            }
        }
    }
    all->Release();
    return launched;
}
}
extern "C" void reformany_stop_shake_listener(){
    HANDLE event=OpenEventW(EVENT_MODIFY_STATE,FALSE,kStopName);
    if(event){SetEvent(event);CloseHandle(event);}
}
extern "C" void reformany_win_shake_listen(Tick tick,Launch launch){
    if(!tick||!launch)return;
    HANDLE mutex=CreateMutexW(nullptr,TRUE,kMutexName);
    if(!mutex)return;
    if(GetLastError()==ERROR_ALREADY_EXISTS){CloseHandle(mutex);return;}
    HANDLE stop=CreateEventW(nullptr,TRUE,FALSE,kStopName);
    if(!stop){ReleaseMutex(mutex);CloseHandle(mutex);return;}
    const HRESULT com=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    if(FAILED(com)){CloseHandle(stop);ReleaseMutex(mutex);CloseHandle(mutex);return;}
    g_tick=tick;g_launch=launch;
    // Force creation of this thread's message queue before installing hook.
    MSG message{};
    PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);
    g_hook=SetWindowsHookExW(WH_MOUSE_LL,hook,GetModuleHandleW(nullptr),0);
    if(g_hook){
        while(true){
            const DWORD status=MsgWaitForMultipleObjects(1,&stop,FALSE,INFINITE,QS_ALLINPUT);
            if(status==WAIT_OBJECT_0||status==WAIT_FAILED)break;
            if(status!=WAIT_OBJECT_0+1)continue;
            while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){
                if(message.message==WM_QUIT)goto finish;
                if(message.message==kGestureMsg){
                    const HWND source=reinterpret_cast<HWND>(message.wParam);
                    if(source&&IsWindow(source)&&(GetAsyncKeyState(VK_LBUTTON)&0x8000)){
                        locate_shell_data(source);
                    }
                }else{
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
    }
finish:
    if(g_hook){UnhookWindowsHookEx(g_hook);g_hook=nullptr;}
    g_tick=nullptr;g_launch=nullptr;g_source=nullptr;
    CoUninitialize();CloseHandle(stop);ReleaseMutex(mutex);CloseHandle(mutex);
}
