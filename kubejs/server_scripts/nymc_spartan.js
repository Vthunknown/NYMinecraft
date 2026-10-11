// NYMinecraft — правки Spartan Weaponry, которые не закрывает его конфиг.
//
// Масла выключены (config/spartanweaponry-common.toml, [oil] disable_oil_recipes = true), но этот флаг
// убирает только варку масел. Крафт смазки, пустого масла и нанесения масла на оружие у Spartan
// к флагу не привязан — убираем здесь. В JEI оба предмета скрыты (kubejs/client_scripts/nymc_hide_items.js).
//
// Серверный скрипт KubeJS: применяется после перезапуска мира или командой /reload.
// Путь в репозитории: kubejs/server_scripts/nymc_spartan.js

ServerEvents.recipes(event => {
  event.remove({ id: 'spartanweaponry:grease_ball' })
  event.remove({ id: 'spartanweaponry:weapon_oil_base' })
  event.remove({ id: 'spartanweaponry:apply_oil' })
})
