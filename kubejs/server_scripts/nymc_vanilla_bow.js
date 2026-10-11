// NYMinecraft — ванильный лук выводим из игры в пользу луков Archery Expansion.
// С Epic Fight + Epic Arsenal у ванильного лука сломаны анимации (держится как огнестрел).
//
// - Рецепты, где ванильный лук — ингредиент (раздатчик и т. п.), переводим на деревянный лук Archery Expansion.
// - Рецепт ванильного лука убираем.
// - Найденный ванильный лук (сундуки, жители, старые скелеты) переделывается в деревянный лук Archery Expansion.
// В JEI ванильный лук скрыт — kubejs/client_scripts/nymc_hide_items.js.
//
// Серверный скрипт KubeJS: применяется после перезапуска мира или командой /reload.
// Путь в репозитории: kubejs/server_scripts/nymc_vanilla_bow.js

ServerEvents.recipes(event => {
  // Сначала переводим рецепты-потребители, потом убираем сам лук и добавляем переделку
  event.replaceInput({ input: 'minecraft:bow' }, 'minecraft:bow', 'archeryexp:wooden_bow')
  event.remove({ output: 'minecraft:bow' })
  event.shapeless('archeryexp:wooden_bow', ['minecraft:bow']).id('nymc:vanilla_bow_to_wooden_bow')
})
