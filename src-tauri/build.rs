fn main() {
    #[cfg(target_os = "windows")]
    {
        cc::Build::new()
            .cpp(true)
            .file("src/shake_win.cpp")
            .flag_if_supported("/std:c++17")
            .compile("reformany_shake");
        for library in ["ole32", "oleaut32", "shell32", "user32", "gdi32", "uuid"] {
            println!("cargo:rustc-link-lib={library}");
        }
        println!("cargo:rerun-if-changed=src/shake_win.cpp");
    }
    tauri_build::build();
}
