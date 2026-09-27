// Keep the release build from opening a console window behind the app on
// Windows. Debug builds keep the console so `pnpm desktop:dev` can print
// startup diagnostics.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    axis_desktop_lib::run()
}
