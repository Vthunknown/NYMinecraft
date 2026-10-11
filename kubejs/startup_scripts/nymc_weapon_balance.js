// NYMinecraft — баланс урона оружия игроков.
//
// Правило «риск = награда» (урон в секунду относительно ближнего боя того же тира):
//   ближний бой — 1,0 (самый опасный);
//   огнестрел — до ~0,8 в корпус (очередь без перезарядок), ~1,3 при попаданиях в голову (патроны от технаря);
//   луки и арбалеты — ~0,65–0,7, но урон собран в одном выстреле (~22 на алмазном луке),
//     60% урона стрелы игнорирует броню, скрытный выстрел ×2 по мобу без цели (кроме боссов);
//   тяжёлые арбалеты Spartan — свой множитель (болт и так бьёт сильно) и 75% пробития;
//   метательное оружие Spartan (ножи, томагавки, дротики, бумеранги) — своя категория;
//   заклинания — без изменений (рывки урона, ограниченные маной).
// Против игроков множители не действуют. Лимит урона по боссам (nymc_boss_caps.js) применяется после множителей.
//
// Огнестрел правится через событие самого TaCZ (EntityHurtByGunEvent.Pre): базовый урон пули и множитель
// попадания в голову по отдельности. Остальное — через LivingHurtEvent, до брони.
//
// Весь скрипт обёрнут в функцию, чтобы его имена не пересекались с nymc_boss_caps.js.
// Внутри циклов и блоков if — только let: Rhino (движок JS в KubeJS) ломается на const в цикле.
//
// Startup-скрипт KubeJS: изменения применяются только после перезапуска игры или сервера.
// Путь в репозитории: kubejs/startup_scripts/nymc_weapon_balance.js

(function () {
  const DamageTypeTags = Java.loadClass('net.minecraft.tags.DamageTypeTags')
  const EntityType = Java.loadClass('net.minecraft.world.entity.EntityType')
  const ForgeRegistries = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
  const ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
  const Attributes = Java.loadClass('net.minecraft.world.entity.ai.attributes.Attributes')

  // ===== Настройки. Тут можешь поменять. =====
  const MULTIPLIERS = {
    melee: 1.5,    // ближний бой: мечи, топоры, всё оружие Epic Fight
    bow: 3.5,      // стрелы из луков (Archery Expansion и прочие)
    crossbow: 2.5, // болты и стрелы из арбалетов: у ванильного арбалета база выше, чем у лука того же уровня
    heavy_crossbow: 1.1, // тяжёлые арбалеты Spartan: болт без множителя уже ~16–25
    thrown: 1.5,   // метательное оружие Spartan в броске (в руке это ближний бой)
    spell: 1.0,    // заклинания Iron's Spells
    other: 1.0,    // всё остальное от игрока (поджог, взрывы, питомцы и т. п.)
  }

  // Огнестрел (TaCZ)
  const BULLET_BASE_MULT = 0.3       // базовый урон пули (в корпус): автомат очередью ~0,8 от ближнего боя
  const BULLET_HEADSHOT_MULT = 1.1   // множитель попадания в голову каждого ствола ×1,1 (1,5 → 1,65)

  // Луки и арбалеты
  const ARROW_ARMOR_PIERCE = 0.60    // доля урона стрелы, которая игнорирует броню
  const HEAVY_CROSSBOW_ARMOR_PIERCE = 0.75 // то же для тяжёлых арбалетов Spartan (своё пробитие болтов обнулено в конфиге Spartan)
  const PIERCE_PER_LEVEL = 0.05      // +5% пробития за уровень: «Раскалывание» (Archery Expansion) на луке, «Пронзание» на арбалете
  const ARROW_ARMOR_PIERCE_MAX = 0.90
  const STEALTH_MULT = 2.0           // скрытный выстрел: стрела по мобу, у которого нет цели (боссы не в счёт)

  // Для тестов. В сборке: false!
  // Каждое попадание игрока: строка в чат этому игроку и в logs/kubejs/startup.log
  const DEBUG_DAMAGE_LOG = false

  // ===== Дальше — логика =====
  const logged = {}

  function logOnce(key, err) {
    if (logged[key]) return
    logged[key] = true
    console.error('[nymc_weapon_balance] Не сработал ни один вариант (' + key + '): ' + err)
  }

  // Пробует варианты по очереди; undefined считается неудачей
  function first(key, variants) {
    let lastErr = null
    for (let i = 0; i < variants.length; i++) {
      try {
        let value = variants[i]()
        if (value !== undefined) return value
        lastErr = 'undefined'
      } catch (err) {
        lastErr = err
      }
    }
    logOnce(key, lastErr)
    throw new Error('[nymc_weapon_balance] не удалось: ' + key + ' — подробности в logs/kubejs/startup.log')
  }

  // Мягкий вариант: если ничего не сработало — вернуть запасное значение, без ошибки в чат
  function firstOr(key, variants, fallback) {
    try {
      return first(key, variants)
    } catch (err) {
      return fallback
    }
  }

  function num(value) {
    const n = Number(value)
    return isNaN(n) ? undefined : n
  }

  function round1(value) {
    return Math.round(value * 10) / 10
  }

  function idOf(entity) {
    return String(EntityType.getKey(entity.getType()))
  }

  function keyOf(entity) {
    return String(entity.hashCode())
  }

  function isBoss(id) {
    const list = global.nymcBossIds || []
    return list.indexOf(id) >= 0
  }

  function attackerOf(source) {
    return first('атакующий', [
      () => source.getEntity(),
      () => source.actual,
      () => source.getActual(),
    ])
  }

  // null — удар без снаряда; UNKNOWN — не удалось узнать (тогда категорию определяем по типу урона)
  const UNKNOWN = { unknown: true }
  function directOf(source) {
    return firstOr('прямой источник урона', [
      () => source.getDirectEntity(),
      () => source.immediate,
      () => source.getImmediate(),
    ], UNKNOWN)
  }

  function msgIdOf(source) {
    return String(firstOr('тип урона', [
      () => source.getMsgId(),
      () => source.msgId,
      () => source.getType(),
    ], '?'))
  }

  function mainHandOf(player) {
    return firstOr('предмет в основной руке', [() => player.getMainHandItem(), () => player.mainHandItem], null)
  }

  function offHandOf(player) {
    return firstOr('предмет во второй руке', [() => player.getOffhandItem(), () => player.offHandItem], null)
  }

  function itemIdOf(stack) {
    if (!stack) return '?'
    return String(firstOr('ID предмета', [
      () => stack.id,
      () => ForgeRegistries.ITEMS.getKey(stack.getItem()),
    ], '?'))
  }

  function tell(player, text) {
    firstOr('сообщение в чат', [
      () => { player.tell(text); return true },
      () => { player.setStatusMessage(text); return true },
    ], false)
  }

  // Зачарования для пробития: ищем один раз в реестре по ID
  let enchantsResolved = false
  let shatteringEnchant = null
  let piercingEnchant = null
  function resolveEnchants() {
    if (enchantsResolved) return
    enchantsResolved = true
    piercingEnchant = ForgeRegistries.ENCHANTMENTS.getValue(new ResourceLocation('minecraft', 'piercing'))
    const it = ForgeRegistries.ENCHANTMENTS.getKeys().iterator()
    while (it.hasNext()) {
      let key = String(it.next())
      if (key.indexOf('minecraft:') !== 0 && key.indexOf(':shattering') > 0) {
        shatteringEnchant = ForgeRegistries.ENCHANTMENTS.getValue(new ResourceLocation(key))
        console.info('[nymc_weapon_balance] Зачарование для пробития луков: ' + key)
        break
      }
    }
    if (!shatteringEnchant) console.warn('[nymc_weapon_balance] Зачарование «Раскалывание» (shattering) не найдено — бонус пробития у луков отключён')
  }

  function enchantLevel(stack, enchant) {
    if (!stack || !enchant) return 0
    return num(firstOr('уровень зачарования', [() => stack.getEnchantmentLevel(enchant)], 0)) || 0
  }

  // Лук или арбалет, из которого стреляли: основная рука, иначе вторая
  function rangedWeaponOf(player) {
    const main = mainHandOf(player)
    if (itemIdOf(main).indexOf('bow') >= 0) return main
    const off = offHandOf(player)
    if (itemIdOf(off).indexOf('bow') >= 0) return off
    return null
  }

  function armorPierceOf(player) {
    const weapon = rangedWeaponOf(player)
    if (!weapon) return { pierce: ARROW_ARMOR_PIERCE, weaponId: '?' }
    resolveEnchants()
    const weaponId = itemIdOf(weapon)
    const isCrossbow = weaponId.indexOf('crossbow') >= 0
    const base = weaponId.indexOf('heavy_crossbow') >= 0 ? HEAVY_CROSSBOW_ARMOR_PIERCE : ARROW_ARMOR_PIERCE
    const level = enchantLevel(weapon, isCrossbow ? piercingEnchant : shatteringEnchant)
    return { pierce: Math.min(ARROW_ARMOR_PIERCE_MAX, base + PIERCE_PER_LEVEL * level), weaponId: weaponId }
  }

  // Доля урона, которая остаётся после брони (ванильная формула)
  function armorKeepFactor(victim, amount) {
    const armor = num(firstOr('броня цели', [
      () => victim.getArmorValue(),
      () => victim.armorValue,
      () => victim.getAttributeValue(Attributes.ARMOR),
    ], 0)) || 0
    if (armor <= 0) return 1
    const toughness = num(firstOr('прочность брони цели', [() => victim.getAttributeValue(Attributes.ARMOR_TOUGHNESS)], 0)) || 0
    const reduction = Math.min(20, Math.max(armor / 5, armor - 4 * amount / (toughness + 8))) / 25
    return Math.max(0.2, 1 - reduction)
  }

  // Есть ли у моба цель. true / false; null — не удалось узнать (бонус не даём)
  function hasTarget(victim) {
    const target = firstOr('цель моба', [() => victim.getTarget(), () => victim.target], UNKNOWN)
    if (target === UNKNOWN) return null
    return !!target
  }

  // Категория по типу урона и прямому источнику (снаряду). Заклинания проверяются раньше стрел:
  // снаряды заклинаний бывают «bolt».
  function categoryOf(msgId, directId, directIsAttacker) {
    const m = msgId.toLowerCase()
    const d = directId.toLowerCase()
    if (d.indexOf('tacz:') === 0 || m.indexOf('tacz') >= 0 || m.indexOf('bullet') >= 0) return 'bullet'
    if (d.indexOf('irons_spellbooks:') === 0 || m.indexOf('irons') >= 0 || m.indexOf('magic') >= 0 || m.indexOf('spell') >= 0) return 'spell'
    if (d.indexOf('spartanweaponry:') === 0 && (d.indexOf('throw') >= 0 || d.indexOf('tomahawk') >= 0 || d.indexOf('javelin') >= 0 || d.indexOf('boomerang') >= 0)) return 'thrown'
    if (d.indexOf('arrow') >= 0 || d.indexOf('bolt') >= 0 || d === 'minecraft:trident' || m === 'arrow' || m === 'trident') return 'arrow'
    if (directIsAttacker || m === 'player') return 'melee'
    return 'other'
  }

  // ----- Огнестрел: событие TaCZ до нанесения урона -----
  ForgeEvents.onEvent('com.tacz.guns.api.event.common.EntityHurtByGunEvent$Pre', event => {
    if (String(event.getLogicalSide()) !== 'SERVER') return
    const attacker = event.getAttacker()
    const victim = event.getHurtEntity()
    if (!attacker || !victim || idOf(attacker) !== 'minecraft:player') return
    if (idOf(victim) === 'minecraft:player') return

    const baseBefore = event.getBaseAmount()
    const headBefore = event.getHeadshotMultiplier()
    event.setBaseAmount(baseBefore * BULLET_BASE_MULT)
    event.setHeadshotMultiplier(headBefore * BULLET_HEADSHOT_MULT)

    if (DEBUG_DAMAGE_LOG) {
      let text = '[урон] bullet · ствол ' + event.getGunId() + (event.isHeadShot() ? ' · В ГОЛОВУ' : ' · в корпус') +
        ' · база ' + round1(baseBefore) + ' → ' + round1(baseBefore * BULLET_BASE_MULT) +
        ' · голова ×' + round1(headBefore) + ' → ×' + round1(headBefore * BULLET_HEADSHOT_MULT) + ' по ' + idOf(victim)
      tell(attacker, text)
      console.info('[nymc_weapon_balance] ' + text)
    }
  })

  // ----- Остальное оружие: до брони -----
  ForgeEvents.onEvent('net.minecraftforge.event.entity.living.LivingHurtEvent', event => {
    const victim = event.getEntity()
    if (victim.level.isClientSide()) return

    const source = event.getSource()
    if (source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return

    const attacker = attackerOf(source)
    if (!attacker || idOf(attacker) !== 'minecraft:player') return
    const victimId = idOf(victim)
    // Против игроков множители не применяем
    if (victimId === 'minecraft:player') return

    const direct = directOf(source)
    const known = direct !== UNKNOWN
    const directIsAttacker = known && (!direct || keyOf(direct) === keyOf(attacker))
    const directId = !known ? '?' : direct ? idOf(direct) : '-'
    const msgId = msgIdOf(source)
    const category = categoryOf(msgId, directId, directIsAttacker)

    // Пули уже обработаны в событии TaCZ
    if (category === 'bullet') return

    const before = event.getAmount()
    let notes = ''
    let ap = null
    let mult = MULTIPLIERS[category]
    if (category === 'arrow') {
      ap = armorPierceOf(attacker)
      mult = ap.weaponId.indexOf('heavy_crossbow') >= 0 ? MULTIPLIERS.heavy_crossbow
        : ap.weaponId.indexOf('crossbow') >= 0 ? MULTIPLIERS.crossbow : MULTIPLIERS.bow
    }
    let amount = before * mult

    if (category === 'arrow') {
      // Скрытный выстрел: моб ещё никого не атакует; боссы не в счёт
      if (!isBoss(victimId) && hasTarget(victim) === false) {
        amount = amount * STEALTH_MULT
        notes = notes + ' · СКРЫТНО ×' + STEALTH_MULT
      }
      // Пробитие брони: часть урона компенсирует потерю на броне
      let keep = armorKeepFactor(victim, amount)
      if (keep < 1) amount = amount * ((1 - ap.pierce) + ap.pierce / keep)
      notes = ' · оружие ' + ap.weaponId + ' · пробитие ' + Math.round(ap.pierce * 100) + '%' +
        (keep < 1 ? ' (броня оставляет ' + Math.round(keep * 100) + '%)' : '') + notes
    }

    if (amount !== before) event.setAmount(amount)

    if (DEBUG_DAMAGE_LOG) {
      let held = category === 'arrow' ? '' : ' · в руке ' + itemIdOf(mainHandOf(attacker))
      let text = '[урон] ' + category + ' · тип ' + msgId + ' · снаряд ' + directId + held + notes +
        ' · ' + round1(before) + (amount !== before ? ' → ' + round1(amount) : '') + ' по ' + victimId
      tell(attacker, text)
      console.info('[nymc_weapon_balance] ' + text)
    }
  })

  ForgeEvents.onEvent('net.minecraftforge.event.server.ServerStartedEvent', event => {
    resolveEnchants()
    console.info('[nymc_weapon_balance] Множители: ближний ' + MULTIPLIERS.melee + ', луки ' + MULTIPLIERS.bow + ', арбалеты ' + MULTIPLIERS.crossbow +
      ', тяжёлые арбалеты ' + MULTIPLIERS.heavy_crossbow + ', метательное ' + MULTIPLIERS.thrown +
      ', заклинания ' + MULTIPLIERS.spell + ', прочее ' + MULTIPLIERS.other + '; пули: база ×' + BULLET_BASE_MULT +
      ', голова ×' + BULLET_HEADSHOT_MULT + '; пробитие стрел ' + Math.round(ARROW_ARMOR_PIERCE * 100) + '%, болтов тяжёлого арбалета ' +
      Math.round(HEAVY_CROSSBOW_ARMOR_PIERCE * 100) + '%')
    if (DEBUG_DAMAGE_LOG) console.warn('[nymc_weapon_balance] ТЕСТ: включён журнал урона')
  })
})()
