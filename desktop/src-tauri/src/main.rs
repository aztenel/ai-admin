// Пульт чатов AI-администратора для Windows.
// Программа — окно с пультом сайта (/inbox): всё, что меняется в пульте на сайте, сразу есть и здесь.
// Своё: значок у часов (трей), закрыть окно = свернуть в трей, запуск вместе с Windows,
// один экземпляр, уведомления Windows (их вызывает сам пульт), чужие ссылки — в браузере.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;

const PROD: &str = "https://ai-admin.azikonps4.workers.dev";
const DEV: &str = "https://dev-ai-admin.azikonps4.workers.dev";
const MAIN: &str = "main";

// на страницах сайта вне пульта (рассылки, заявки, проверка запуска) — кнопка «← Пульт»: у программы нет адресной строки и «назад»
const BACK_JS: &str = r#"(function () {
  var p = location.pathname;
  if (!/(^|\.)azikonps4\.workers\.dev$/.test(location.hostname) || p.indexOf("/inbox") === 0 || p === "/login") return;
  addEventListener("DOMContentLoaded", function () {
    var c = new URLSearchParams(location.search).get("c"), a = document.createElement("a");
    a.href = "/inbox" + (c ? "?c=" + encodeURIComponent(c) : ""); a.textContent = "← Пульт";
    a.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483647;padding:10px 18px;border-radius:22px;background:#F4B740;color:#1E1500;font:600 15px 'Segoe UI',system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.3)";
    document.body.appendChild(a);
  });
})();"#;

// проверка сборки: на странице видно, дошли ли до неё возможности программы (уведомления, ссылки)
const SELFTEST_JS: &str = r#"addEventListener("load", function () {
  var t = window.__TAURI__, d = document.createElement("div");
  d.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;padding:10px 14px;border-radius:12px;background:#111;color:#7CFC9A;font:14px Consolas,monospace";
  d.textContent = "TAURI " + (t ? "OK" : "НЕТ") + " · notification " + (t && t.notification ? "OK" : "НЕТ") + " · opener " + (t && t.opener ? "OK" : "НЕТ");
  document.body.appendChild(d);
  // работают ли таймеры, пока окно спрятано в трей (от этого зависят уведомления о новых сообщениях)
  var d2 = d.cloneNode(false); d2.style.top = "58px"; document.body.appendChild(d2);
  var ticks = 0, hid = 0, last = Date.now(), gap = 0;
  setInterval(function () { var n = Date.now(); gap = Math.max(gap, n - last); last = n; ticks++; if (document.visibilityState === "hidden") hid++;
    d2.textContent = "таймер: " + ticks + " · в трее: " + hid + " · макс. пауза " + Math.round(gap / 1000) + " с"; }, 5000);
  if (t && t.notification) Promise.resolve(t.notification.isPermissionGranted()).then(function (g) { d.textContent += " · разрешение " + g; t.notification.sendNotification({ title: "Пульт", body: "Проверка уведомления" }); d.textContent += " · отправлено"; }).catch(function (e) { d.textContent += " · ошибка " + e; });
});"#;

// какой сайт открывать: боевой (по умолчанию) или черновик — выбор хранится в файле настроек программы
fn site(app: &AppHandle) -> &'static str {
    let path = app.path().app_config_dir().map(|d| d.join("site.txt"));
    match path.ok().and_then(|p| fs::read_to_string(p).ok()) {
        Some(s) if s.trim() == "dev" => DEV,
        _ => PROD,
    }
}

fn set_site(app: &AppHandle, dev: bool) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("site.txt"), if dev { "dev" } else { "prod" });
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let url = format!("{}/inbox", if dev { DEV } else { PROD });
        let _ = w.eval(&format!("location.replace({:?})", url));
        show(app);
    }
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// свои страницы — в окне; всё остальное (WhatsApp, карты, телефон, чужие сайты) — в браузере или программе Windows
fn ours(url: &tauri::Url) -> bool {
    match url.scheme() {
        "about" | "data" | "blob" | "tauri" => true,
        "https" | "http" => url
            .host_str()
            .map(|h| h == "ai-admin.azikonps4.workers.dev" || h.ends_with(".azikonps4.workers.dev") || h == "localhost" || h == "tauri.localhost")
            .unwrap_or(false),
        _ => false,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            // PULT_URL — для проверки сборки: открыть другую страницу наших сайтов (например, /demo без входа)
            let start = std::env::var("PULT_URL").ok().filter(|u| u.starts_with("https://")).unwrap_or_else(|| format!("{}/inbox", site(&handle)));
            let selftest = std::env::var("PULT_SELFTEST").map(|v| v == "1").unwrap_or(false);
            // запуск вместе с Windows — окно не показываем, пульт работает в трее и присылает уведомления
            let hidden = std::env::args().any(|a| a == "--hidden");
            let nav = handle.clone();
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(start.parse().expect("адрес пульта")))
                .title("Пульт")
                .inner_size(1280.0, 820.0)
                .min_inner_size(380.0, 560.0)
                .center()
                .visible(!hidden)
                .initialization_script(BACK_JS)
                .initialization_script(if selftest { SELFTEST_JS } else { "" })
                .on_navigation(move |url| {
                    if ours(url) {
                        return true;
                    }
                    let _ = nav.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .build()?;

            // значок у часов: открыть, автозапуск, выбор сайта, выход
            let auto_on = app.autolaunch().is_enabled().unwrap_or(false);
            let is_dev = site(&handle) == DEV;
            let open_i = MenuItem::with_id(app, "open", "Открыть пульт", true, None::<&str>)?;
            let auto_i = CheckMenuItem::with_id(app, "auto", "Запускать вместе с Windows", true, auto_on, None::<&str>)?;
            let prod_i = CheckMenuItem::with_id(app, "site_prod", "Сайт: рабочий", true, !is_dev, None::<&str>)?;
            let dev_i = CheckMenuItem::with_id(app, "site_dev", "Сайт: черновик (для проверки)", true, is_dev, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open_i, &sep1, &auto_i, &prod_i, &dev_i, &sep2, &quit_i])?;
            let (auto_c, prod_c, dev_c) = (auto_i.clone(), prod_i.clone(), dev_i.clone());
            let mut tray = TrayIconBuilder::with_id("pult")
                .tooltip("Пульт — AI-администратор")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show(app),
                    "auto" => {
                        let al = app.autolaunch();
                        let on = al.is_enabled().unwrap_or(false);
                        let _ = if on { al.disable() } else { al.enable() };
                        let _ = auto_c.set_checked(al.is_enabled().unwrap_or(!on));
                    }
                    "site_prod" => {
                        let _ = prod_c.set_checked(true);
                        let _ = dev_c.set_checked(false);
                        set_site(app, false);
                    }
                    "site_dev" => {
                        let _ = prod_c.set_checked(false);
                        let _ = dev_c.set_checked(true);
                        set_site(app, true);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        // крестик не закрывает программу, а прячет окно в трей: уведомления продолжают приходить
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить пульт");
}
