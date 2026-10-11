// NYMinecraft — предметы, скрытые в JEI.
// Клиентский скрипт KubeJS: применяется после перезапуска игры (или F3+T — перезагрузка ресурсов).
// Путь в репозитории: kubejs/client_scripts/nymc_hide_items.js

JEIEvents.hideItems(event => {
  // Ванильный лук: заменён луками Archery Expansion (см. kubejs/server_scripts/nymc_vanilla_bow.js)
  event.hide('minecraft:bow')
})
