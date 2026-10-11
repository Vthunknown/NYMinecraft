// NYMinecraft — скейлинг боссов по числу игроков и тирам + лимит урона за удар.
//
// Игроки в бою — все живые не-наблюдатели в кубе ±ZONE блоков вокруг босса (128×128×128),
// плюс те, кто бил босса за последние FIGHT_TIMEOUT_MS, где бы они ни стояли.
// В бою скейлинг только растёт; бой кончился (по боссу не били FIGHT_TIMEOUT_MS) — пересчёт по текущему составу.
//
// Наши боссы (BOSSES): у каждого тир (1–7) и подвижность.
//   HP: статичные и крупные +150% за игрока сверх первого, подвижные +75%; текущий % HP сохраняется.
//   Лимит HIT_CAP за удар. Урон босса по игрокам растёт по тиру.
//   Регенерация в бою — фиксированный % текущего (увеличенного) HP в секунду по тиру; вне боя (не били 5 с) — 1%/с.
// Cataclysm (CATACLYSM): лимиты урона и регенерация — свои (cataclysm-common.toml), наша регенерация не добавляется.
//   HP +10% за игрока сверх первого, урон босса растёт по тиру.
//
// KubeJS прячет часть стандартных методов Minecraft (level(), getGameTime, getUUID), поэтому каждое
// обращение к сущности идёт через first(): пробуем варианты по очереди, если не сработал ни один — пишем в лог.
// Внутри циклов и блоков if — только let: Rhino (движок JS в KubeJS) ломается на const в цикле.
//
// Startup-скрипт KubeJS: изменения применяются только после перезапуска игры или сервера.
// Путь в репозитории: kubejs/startup_scripts/nymc_boss_caps.js

const DamageTypeTags = Java.loadClass('net.minecraft.tags.DamageTypeTags')
const EntityType = Java.loadClass('net.minecraft.world.entity.EntityType')
const ForgeRegistries = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
const ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
const Attributes = Java.loadClass('net.minecraft.world.entity.ai.attributes.Attributes')

// ===== Настройки. Тут можешь поменять. =====
const ZONE = 64                    // полуразмер куба вокруг босса (64 → куб 128×128×128)
const MAX_PLAYERS = 8              // больше этого числа игроков босс не усиливается
const FIGHT_TIMEOUT_MS = 30000     // бой закончен, если по боссу не били 30 с; столько же помним, кто бил
// Админ, который смотрит бой, — в режиме наблюдателя: наблюдатели не считаются.

// Для тестов. В сборке: DEBUG_EXTRA_PLAYERS = 0, DEBUG_HUD = false!
const DEBUG_EXTRA_PLAYERS = 0      // столько «виртуальных» игроков добавляется к реальным
const DEBUG_HUD = false            // строка над хотбаром: HP босса, число игроков, регенерация, тир

// Наши боссы — общее для всех тиров
const HIT_CAP = 35                 // максимум урона по боссу за один удар
const HP_PER_PLAYER_STATIC = 1.5   // статичные и крупные: +150% HP за каждого игрока сверх первого
const HP_PER_PLAYER_MOBILE = 0.75  // подвижные: +75%
const IDLE_REGEN_DELAY_MS = 5000   // через сколько мс без урона включается регенерация вне боя
const IDLE_REGEN_PERCENT = 0.01    // регенерация вне боя: 1% максимального HP в секунду

// Cataclysm
const CATA_HP_PER_PLAYER = 0.10    // +10% HP за каждого игрока сверх первого

// Тиры.
//   damage     — урон нашего босса по игрокам, +доля за каждого игрока сверх первого
//   fightRegen — регенерация нашего босса в бою, доля текущего максимального HP в секунду.
//                Босс убиваем, пока соло-бой короче 1 / fightRegen секунд (0,3% → ~5,5 мин)
//   cataDamage — урон босса Cataclysm, +доля за каждого игрока сверх первого
const TIERS = {
  1: { damage: 0.10,  fightRegen: 0.003,  cataDamage: 0.04 }, // старт
  2: { damage: 0.125, fightRegen: 0.003,  cataDamage: 0.05 }, // ранняя
  3: { damage: 0.15,  fightRegen: 0.0025, cataDamage: 0.06 }, // ранняя середина
  4: { damage: 0.175, fightRegen: 0.0025, cataDamage: 0.07 }, // середина
  5: { damage: 0.20,  fightRegen: 0.002,  cataDamage: 0.08 }, // поздняя
  6: { damage: 0.225, fightRegen: 0.002,  cataDamage: 0.10 }, // поздняя+ (Ignis +10% проверен)
  7: { damage: 0.25,  fightRegen: 0.002,  cataDamage: 0.12 }, // эндгейм
}

// Наши боссы: тир и подвижность (mobile: true — трудно попадать, меньше HP; false — статичный или крупный)
const BOSSES = {
  // Тир 1 — старт
  'twilightforest:naga':             { tier: 1, mobile: true },
  'mowziesmobs:ferrous_wroughtnaut': { tier: 1, mobile: false },
  'aquamirae:maze_mother':           { tier: 1, mobile: true },

  // Тир 2 — ранняя
  'twilightforest:lich':             { tier: 2, mobile: true },
  'mowziesmobs:frostmaw':            { tier: 2, mobile: true },
  'mowziesmobs:umvuthi':             { tier: 2, mobile: false },

  // Тир 3 — ранняя середина
  'twilightforest:minoshroom':       { tier: 3, mobile: true },
  'twilightforest:alpha_yeti':       { tier: 3, mobile: true },
  'mowziesmobs:sculptor':            { tier: 3, mobile: true },  // данных о бое мало — проверить в игре
  'irons_spellbooks:dead_king':      { tier: 3, mobile: true },

  // Тир 4 — середина
  'twilightforest:hydra':            { tier: 4, mobile: false },
  'twilightforest:snow_queen':       { tier: 4, mobile: true },
  'twilightforest:knight_phantom':   { tier: 4, mobile: true },
  'aquamirae:captain_cornelia':      { tier: 4, mobile: true },
  'alexscaves:hullbreaker':          { tier: 4, mobile: true },

  // Тир 5 — поздняя
  'twilightforest:ur_ghast':         { tier: 5, mobile: false },
  'alexscaves:forsaken':             { tier: 5, mobile: true },  // своя регенерация в темноте до 50% — складывается с нашей

  // Тир 6 — поздняя+
  'irons_spellbooks:fire_boss':      { tier: 6, mobile: true },
  'alexscaves:luxtructosaurus':      { tier: 6, mobile: false },
  'alexsmobs:void_worm':             { tier: 6, mobile: true },

  // Ванильные — тут можешь включить, убрав // в начале строки
  // 'minecraft:wither':             { tier: 5, mobile: true },
  // 'minecraft:ender_dragon':       { tier: 6, mobile: true },
}

// Боссы Cataclysm: тир
const CATACLYSM = {
  'cataclysm:the_harbinger':         { tier: 5 },
  'cataclysm:netherite_monstrosity': { tier: 5 },
  'cataclysm:ignis':                 { tier: 6 },
  'cataclysm:ancient_remnant':       { tier: 6 },
  'cataclysm:the_leviathan':         { tier: 6 },
  'cataclysm:ender_guardian':        { tier: 7 },
  'cataclysm:maledictus':            { tier: 7 },
  'cataclysm:scylla':                { tier: 7 },
}

// ===== Дальше — логика =====
// Список боссов для других скриптов (nymc_weapon_balance.js: скрытный выстрел по боссам не действует)
global.nymcBossIds = Object.keys(BOSSES).concat(Object.keys(CATACLYSM))

const tracked = {}   // загруженные боссы: ключ → сущность
const hitters = {}   // кто бил босса: ключ босса → { ключ игрока: время удара }
const logged = {}
let tickCounter = 0

function logOnce(key, err) {
  if (logged[key]) return
  logged[key] = true
  console.error('[nymc_boss_caps] Не сработал ни один вариант (' + key + '): ' + err)
}

// Пробует варианты по очереди; undefined считается неудачей (так Rhino отвечает на несуществующее свойство)
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
  throw new Error('[nymc_boss_caps] не удалось: ' + key + ' — подробности в logs/kubejs/startup.log')
}

function num(value) {
  const n = Number(value)
  return isNaN(n) ? undefined : n
}

function bool(value) {
  if (value === true || value === false) return value
  if (value === undefined || value === null) return undefined
  const s = String(value)
  return s === 'true' ? true : s === 'false' ? false : undefined
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function idOf(entity) {
  return String(EntityType.getKey(entity.getType()))
}

function kindOf(id) {
  if (id in BOSSES) return 'ours'
  if (id in CATACLYSM) return 'cata'
  return null
}

function infoOf(id, kind) {
  return kind === 'ours' ? BOSSES[id] : CATACLYSM[id]
}

function hpPerPlayerOf(id, kind) {
  if (kind === 'cata') return CATA_HP_PER_PLAYER
  return BOSSES[id].mobile ? HP_PER_PLAYER_MOBILE : HP_PER_PLAYER_STATIC
}

// Ключ сущности: hashCode — метод самой Java, KubeJS его не прячет
function keyOf(entity) {
  return first('ключ сущности', [() => String(entity.hashCode())])
}

function coord(entity, axis) {
  return first('координата ' + axis, [
    () => num(entity[axis]),
    () => num(axis === 'x' ? entity.getX() : axis === 'y' ? entity.getY() : entity.getZ()),
  ])
}

function playersOf(boss) {
  return first('список игроков', [
    () => boss.level.getPlayers(),
    () => boss.level.players(),
    () => boss.level.players,
  ])
}

function isAliveE(entity) {
  return first('жив ли', [() => bool(entity.isAlive()), () => bool(entity.alive)])
}

function isRemovedE(entity) {
  return first('удалён ли', [() => bool(entity.isRemoved()), () => bool(entity.removed)])
}

function isSpectatorE(player) {
  return first('наблюдатель ли', [() => bool(player.isSpectator()), () => bool(player.spectator)])
}

function healthOf(entity) {
  return first('здоровье', [() => num(entity.getHealth()), () => num(entity.health)])
}

function maxHealthOf(entity) {
  return first('макс. здоровье', [() => num(entity.getMaxHealth()), () => num(entity.maxHealth)])
}

function setHealthOf(entity, value) {
  first('установка здоровья', [
    () => { entity.setHealth(value); return true },
    () => { entity.health = value; return true },
  ])
}

function healOf(entity, value) {
  const max = maxHealthOf(entity)
  setHealthOf(entity, Math.min(max, healthOf(entity) + value))
}

function baseMaxHealthOf(entity) {
  return first('базовое макс. здоровье', [
    () => num(entity.getAttribute(Attributes.MAX_HEALTH).getBaseValue()),
    () => num(entity.getAttributeBaseValue(Attributes.MAX_HEALTH)),
    () => maxHealthOf(entity),
  ])
}

function setBaseMaxHealthOf(entity, value) {
  first('установка макс. здоровья', [
    () => { entity.setMaxHealth(value); return true },
    () => { entity.getAttribute(Attributes.MAX_HEALTH).setBaseValue(value); return true },
    () => { entity.maxHealth = value; return true },
  ])
}

function attackerOf(source) {
  // null — законный ответ (у урона нет виновника), undefined — вариант не сработал
  return first('атакующий', [
    () => source.getEntity(),
    () => source.actual,
    () => source.getActual(),
  ])
}

function showStatus(player, text) {
  first('строка над хотбаром', [
    () => { player.setStatusMessage(text); return true },
    () => { player.tell(text); return true },
  ])
}

function track(entity) {
  tracked[keyOf(entity)] = entity
}

// Игроки в бою: в кубе вокруг босса или били его за последние FIGHT_TIMEOUT_MS
function fightersOf(boss, now) {
  const bx = coord(boss, 'x')
  const by = coord(boss, 'y')
  const bz = coord(boss, 'z')
  const recent = hitters[keyOf(boss)] || {}
  const list = playersOf(boss)
  const result = []
  for (let i = 0; i < list.size(); i++) {
    let p = list.get(i)
    if (isSpectatorE(p) || !isAliveE(p)) continue
    let inZone = Math.abs(coord(p, 'x') - bx) <= ZONE && Math.abs(coord(p, 'y') - by) <= ZONE && Math.abs(coord(p, 'z') - bz) <= ZONE
    let hitTime = recent[keyOf(p)] || 0
    if (inZone || now - hitTime < FIGHT_TIMEOUT_MS) result.push(p)
  }
  return result
}

// HP через базовое значение атрибута: исходная база хранится в данных босса, текущий % HP сохраняется
function applyHp(boss, n, perPlayer) {
  const data = boss.getPersistentData()
  let base = data.getDouble('nymc_base_hp')
  if (base <= 0) {
    base = baseMaxHealthOf(boss)
    data.putDouble('nymc_base_hp', base)
  }
  const ratio = healthOf(boss) / maxHealthOf(boss)
  setBaseMaxHealthOf(boss, base * (1 + perPlayer * (n - 1)))
  setHealthOf(boss, maxHealthOf(boss) * ratio)
}

function updateBoss(boss, now) {
  const id = idOf(boss)
  const kind = kindOf(id)
  if (!kind) return
  const info = infoOf(id, kind)
  const tier = TIERS[info.tier]

  const data = boss.getPersistentData()
  const lastHit = data.getDouble('nymc_last_hit')
  const inFight = lastHit > 0 && now - lastHit < FIGHT_TIMEOUT_MS

  // Число игроков: в бою только растёт, вне боя — по текущему составу
  const fighters = fightersOf(boss, now)
  let count = fighters.length
  if (count > 0) count += DEBUG_EXTRA_PLAYERS
  count = Math.max(1, Math.min(MAX_PLAYERS, count))
  const current = data.getInt('nymc_n') || 1
  const n = inFight ? Math.max(current, count) : count
  if (n !== current) {
    data.putInt('nymc_n', n)
    applyHp(boss, n, hpPerPlayerOf(id, kind))
  }

  // Регенерация, HP в секунду — только у наших боссов; у Cataclysm своя
  let regen = 0
  if (kind === 'ours') {
    let max = maxHealthOf(boss)
    regen = tier.fightRegen * max
    // Не били 5 с — работает более сильная регенерация вне боя (не суммируется с боевой)
    if (now - lastHit >= IDLE_REGEN_DELAY_MS) regen = Math.max(regen, max * IDLE_REGEN_PERCENT)
    if (healthOf(boss) < max) healOf(boss, regen)
  }

  if (DEBUG_HUD) {
    let text = id.split(':')[1] + ': ' + round1(healthOf(boss)) + '/' + round1(maxHealthOf(boss)) + ' HP · игроков ' + n +
      (kind === 'ours' ? ' · реген ' + round1(regen) + '/с' : ' · реген свой') + ' · тир ' + info.tier + (inFight ? ' · бой' : '')
    for (let i = 0; i < fighters.length; i++) {
      showStatus(fighters[i], text)
    }
  }
}

// Учёт загруженных боссов
ForgeEvents.onEvent('net.minecraftforge.event.entity.EntityJoinLevelEvent', event => {
  if (event.getLevel().isClientSide()) return
  const entity = event.getEntity()
  if (kindOf(idOf(entity))) track(entity)
})

ForgeEvents.onEvent('net.minecraftforge.event.entity.EntityLeaveLevelEvent', event => {
  if (event.getLevel().isClientSide()) return
  const entity = event.getEntity()
  if (kindOf(idOf(entity))) delete tracked[keyOf(entity)]
})

// Раз в секунду: пересчёт игроков, HP и регенерация
ForgeEvents.onEvent('net.minecraftforge.event.TickEvent$ServerTickEvent', event => {
  if (String(event.phase) !== 'END') return
  tickCounter++
  if (tickCounter % 20 !== 0) return
  const now = Date.now()
  Object.keys(tracked).forEach(key => {
    const boss = tracked[key]
    try {
      if (isRemovedE(boss) || !isAliveE(boss)) {
        delete tracked[key]
        delete hitters[key]
        return
      }
      updateBoss(boss, now)
    } catch (err) {
      logOnce('обработка босса раз в секунду', err)
    }
  })
})

// Урон по боссу (лимит за удар, отметка боя, кто бил) и урон босса по игрокам (множитель тира)
ForgeEvents.onEvent('net.minecraftforge.event.entity.living.LivingDamageEvent', event => {
  const victim = event.getEntity()
  // В KubeJS level у сущности — свойство, а не метод
  if (victim.level.isClientSide()) return

  const source = event.getSource()
  // /kill и урон пустоты проходят без изменений
  if (source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) return

  const victimKind = kindOf(idOf(victim))
  if (victimKind) {
    track(victim)
    let hitNow = Date.now()
    victim.getPersistentData().putDouble('nymc_last_hit', hitNow)
    if (victimKind === 'ours' && event.getAmount() > HIT_CAP) event.setAmount(HIT_CAP)
    // Запоминаем игрока, который бил: он участник боя даже вне куба
    let hitter = attackerOf(source)
    if (hitter && idOf(hitter) === 'minecraft:player') {
      let bossKey = keyOf(victim)
      if (!hitters[bossKey]) hitters[bossKey] = {}
      hitters[bossKey][keyOf(hitter)] = hitNow
    }
    return
  }

  if (idOf(victim) !== 'minecraft:player') return
  const attacker = attackerOf(source)
  if (!attacker) return
  const attackerId = idOf(attacker)
  const attackerKind = kindOf(attackerId)
  if (!attackerKind) return

  const n = attacker.getPersistentData().getInt('nymc_n') || 1
  if (n <= 1) return
  const tier = TIERS[infoOf(attackerId, attackerKind).tier]
  const perPlayer = attackerKind === 'ours' ? tier.damage : tier.cataDamage
  event.setAmount(event.getAmount() * (1 + perPlayer * (n - 1)))
})

// Проверка при запуске: какие ID не найдены в сборке, у всех ли боссов корректный тир
ForgeEvents.onEvent('net.minecraftforge.event.server.ServerStartedEvent', event => {
  const ids = Object.keys(BOSSES).concat(Object.keys(CATACLYSM))
  const missing = ids.filter(id => !ForgeRegistries.ENTITY_TYPES.containsKey(new ResourceLocation(id)))
  const badTier = ids.filter(id => !TIERS[infoOf(id, kindOf(id)).tier])
  if (missing.length > 0) {
    console.warn('[nymc_boss_caps] Не найдены в сборке: ' + missing.join(', '))
  } else {
    console.info('[nymc_boss_caps] Все боссы из списка найдены: ' + ids.length)
  }
  if (badTier.length > 0) console.warn('[nymc_boss_caps] Тир не из таблицы TIERS: ' + badTier.join(', '))
  if (DEBUG_EXTRA_PLAYERS > 0) console.warn('[nymc_boss_caps] ТЕСТ: +' + DEBUG_EXTRA_PLAYERS + ' виртуальных игроков')
  if (DEBUG_HUD) console.warn('[nymc_boss_caps] ТЕСТ: включена строка над хотбаром')
})
