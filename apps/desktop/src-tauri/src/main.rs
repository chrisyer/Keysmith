#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if keysmith_desktop_lib::nmh::maybe_run_nmh_from_args() {
        return;
    }
    keysmith_desktop_lib::run()
}
