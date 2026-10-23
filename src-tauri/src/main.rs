// Release'te Windows'ta ek konsol penceresi açılmasın (macOS'ta etkisiz).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kitap_cilt_lib::run()
}
