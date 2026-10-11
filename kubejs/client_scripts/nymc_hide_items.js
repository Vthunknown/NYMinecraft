// NYMinecraft — предметы, скрытые в JEI.
// Клиентский скрипт KubeJS: применяется после перезапуска игры (или F3+T — перезагрузка ресурсов).
// Путь в репозитории: kubejs/client_scripts/nymc_hide_items.js
//
// Выключенные в конфиге предметы Spartan Weaponry (длинные луки, стрелы, лишние материалы, динамит)
// Spartan скрывает в JEI сам. Здесь — только то, что он не скрывает.

JEIEvents.hideItems(event => {
  // Ванильный лук: заменён луками Archery Expansion (см. kubejs/server_scripts/nymc_vanilla_bow.js)
  event.hide('minecraft:bow')

  // Масла Spartan выключены до проектирования алхимии (см. kubejs/server_scripts/nymc_spartan.js)
  event.hide('spartanweaponry:weapon_oil')
  event.hide('spartanweaponry:grease_ball')
})
