// ReformANY Orbit — Windows 11 native File Explorer command.
// Do not perform conversion, file scanning, network I/O or UI work inside Explorer.
// The command receives one path and launches the existing ReformANY.exe orbit mode.
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shobjidl.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <atomic>
#include <new>
#include <string>
#include <vector>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")

// This identifier MUST equal the manifest's com:Class Id and desktop5:Verb Clsid.
static constexpr GUID CLSID_ReformAnyOrbit = {
    0xB3D9875A, 0x7F8E, 0x4BC2,
    { 0x80, 0xAD, 0x2C, 0xF4, 0xB6, 0x0C, 0xF2, 0xF4 }
};

static HMODULE g_module = nullptr;
static std::atomic<long> g_instances{0};
static std::atomic<long> g_locks{0};

static HRESULT DuplicateText(const std::wstring& text, PWSTR* destination) {
    if (!destination) return E_POINTER;
    *destination = nullptr;
    return SHStrDupW(text.c_str(), destination);
}

static std::wstring ApplicationPath() {
    std::wstring path(32768, L'\0');
    const DWORD length = GetModuleFileNameW(g_module, path.data(), static_cast<DWORD>(path.size()));
    if (length == 0 || length >= path.size()) return {};
    path.resize(length);
    const size_t separator = path.find_last_of(L"\\/");
    if (separator == std::wstring::npos) return {};
    return path.substr(0, separator + 1) + L"ReformANY.exe";
}

// Windows C runtime argument-quoting rules, including embedded quotation
// marks and trailing backslashes. Never use cmd.exe for selected paths.
static std::wstring QuoteArgument(const std::wstring& argument) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t character : argument) {
        if (character == L'\\') {
            ++slashes;
        } else if (character == L'\"') {
            result.append(slashes * 2 + 1, L'\\');
            result += L'\"';
            slashes = 0;
        } else {
            result.append(slashes, L'\\');
            result += character;
            slashes = 0;
        }
    }
    result.append(slashes * 2, L'\\');
    return result + L"\"";
}

class OrbitCommand final : public IExplorerCommand {
    std::atomic<ULONG> references_{1};

public:
    OrbitCommand() { ++g_instances; }
    ~OrbitCommand() { --g_instances; }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
        if (!object) return E_POINTER;
        *object = nullptr;
        if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, IID_IExplorerCommand)) {
            *object = static_cast<IExplorerCommand*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG remaining = --references_;
        if (remaining == 0) delete this;
        return remaining;
    }

    HRESULT STDMETHODCALLTYPE GetTitle(IShellItemArray*, LPWSTR* title) override {
        return DuplicateText(L"ReformANY Orbit", title);
    }
    HRESULT STDMETHODCALLTYPE GetIcon(IShellItemArray*, LPWSTR* icon) override {
        const auto executable = ApplicationPath();
        if (executable.empty()) return E_FAIL;
        return DuplicateText(executable + L",0", icon);
    }
    HRESULT STDMETHODCALLTYPE GetToolTip(IShellItemArray*, LPWSTR* tip) override {
        if (!tip) return E_POINTER;
        *tip = nullptr;
        return E_NOTIMPL;
    }
    HRESULT STDMETHODCALLTYPE GetCanonicalName(GUID* identifier) override {
        if (!identifier) return E_POINTER;
        *identifier = CLSID_ReformAnyOrbit;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetState(IShellItemArray* items, BOOL, EXPCMDSTATE* state) override {
        if (!state) return E_POINTER;
        *state = ECS_HIDDEN;
        if (!items) return S_OK;
        DWORD count = 0;
        if (SUCCEEDED(items->GetCount(&count)) && count == 1) *state = ECS_ENABLED;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Invoke(IShellItemArray* items, IBindCtx*) override {
        if (!items) return E_INVALIDARG;
        DWORD count = 0;
        HRESULT result = items->GetCount(&count);
        if (FAILED(result)) return result;
        if (count != 1) return E_INVALIDARG;

        IShellItem* item = nullptr;
        result = items->GetItemAt(0, &item);
        if (FAILED(result)) return result;
        PWSTR raw_path = nullptr;
        result = item->GetDisplayName(SIGDN_FILESYSPATH, &raw_path);
        item->Release();
        if (FAILED(result)) return result;
        if (!raw_path) return E_FAIL;
        const std::wstring selected_path(raw_path);
        CoTaskMemFree(raw_path);

        const std::wstring executable = ApplicationPath();
        if (executable.empty()) return E_FAIL;
        const DWORD attributes = GetFileAttributesW(executable.c_str());
        if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
            return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
        }

        std::wstring arguments = QuoteArgument(executable) + L" orbit " + QuoteArgument(selected_path);
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION process{};
        // Pass the executable path separately; no shell command interpretation.
        if (!CreateProcessW(executable.c_str(), arguments.data(),
            nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process)) {
            return HRESULT_FROM_WIN32(GetLastError());
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetFlags(EXPCMDFLAGS* flags) override {
        if (!flags) return E_POINTER;
        *flags = ECF_DEFAULT;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE EnumSubCommands(IEnumExplorerCommand** commands) override {
        if (!commands) return E_POINTER;
        *commands = nullptr;
        return E_NOTIMPL;
    }
};

class OrbitFactory final : public IClassFactory {
    std::atomic<ULONG> references_{1};
public:
    OrbitFactory() { ++g_instances; }
    ~OrbitFactory() { --g_instances; }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
        if (!object) return E_POINTER;
        *object = nullptr;
        if (IsEqualIID(iid, IID_IUnknown) || IsEqualIID(iid, IID_IClassFactory)) {
            *object = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG remaining = --references_;
        if (remaining == 0) delete this;
        return remaining;
    }
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID iid, void** object) override {
        if (outer) return CLASS_E_NOAGGREGATION;
        auto* instance = new (std::nothrow) OrbitCommand();
        if (!instance) return E_OUTOFMEMORY;
        const HRESULT result = instance->QueryInterface(iid, object);
        instance->Release();
        return result;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override {
        if (lock) ++g_locks; else --g_locks;
        return S_OK;
    }
};

extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = instance;
        DisableThreadLibraryCalls(instance);
    }
    return TRUE;
}
extern "C" __declspec(dllexport) HRESULT STDMETHODCALLTYPE
DllGetClassObject(REFCLSID identifier, REFIID interface_id, void** object) {
    if (!object) return E_POINTER;
    *object = nullptr;
    if (!IsEqualGUID(identifier, CLSID_ReformAnyOrbit)) return CLASS_E_CLASSNOTAVAILABLE;
    auto* factory = new (std::nothrow) OrbitFactory();
    if (!factory) return E_OUTOFMEMORY;
    const HRESULT result = factory->QueryInterface(interface_id, object);
    factory->Release();
    return result;
}
extern "C" __declspec(dllexport) HRESULT STDMETHODCALLTYPE DllCanUnloadNow() {
    return (g_instances.load() == 0 && g_locks.load() == 0) ? S_OK : S_FALSE;
}
