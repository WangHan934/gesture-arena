// Shared descriptions; only the server changes battle state.
export const MONSTERS = [
  { id: 'fire', name: '炎角战魔', glyph: '🔥', color: '#ff9b70', hp: 140, image: 'infernal_hornbeast_views.jpg' },
  { id: 'shadow', name: '紫晶影魔', glyph: '👾', color: '#b9a0ff', hp: 140, image: 'shadowfiend_views.jpg' },
  { id: 'rock', name: '幽晶岩魔', glyph: '💎', color: '#79d8e0', hp: 140, image: 'crystal_golem_views.jpg' },
];

// c.html's six spells, adapted to alternating human turns.
export const SPELLS = [
  { id: 'circle', glyph: '○', name: '火球术', damage: 22, cooldown: 0, key: '1', hint: '造成 22 点伤害' },
  { id: 'line_v', glyph: '│', name: '雷霆万钧', damage: 42, cooldown: 2, key: '2', hint: '造成 42 点伤害' },
  { id: 'two', glyph: '2', name: '治愈之光', heal: 28, cooldown: 1, key: '3', hint: '回复 28 点生命' },
  { id: 'triangle', glyph: '△', name: '召唤援军', support: true, cooldown: 3, key: '4', hint: '下一次伤害额外 +15' },
  { id: 'square', glyph: '□', name: '护盾', shield: true, cooldown: 2, key: '5', hint: '下一次受到的伤害减半' },
  { id: 'line_h', glyph: '—', name: '终极奥义', damage: 70, cooldown: 4, key: '6', hint: '造成 70 点伤害' },
];

export const TURN_MS = 45000;
export const MAX_TURNS = 120;
