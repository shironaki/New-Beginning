import { DEFAULT_LOOK, drawCharacter } from '../render/character.js';
export const APPEARANCE = {
    gender: [['male','Мужчина'],['female','Женщина']],
    hairStyle: [['short','Короткие'],['long','Длинные'],['braid','Коса']],
    skin: [['#e0b594','Светлая'],['#ba8864','Смуглая'],['#80553e','Тёмная']],
    hair: [['#302b29','Тёмные'],['#825332','Каштановые'],['#ba985b','Светлые'],['#969b96','Седые']],
    coat: [['#446d68','Хвойный'],['#785044','Глина'],['#526078','Сумерки'],['#8e7952','Песок']],
    accent: [['#c9a063','Охра'],['#a95143','Рябина'],['#96aaa6','Туман']]
};
export function normalizeLook(value) {
    const out = { ...DEFAULT_LOOK };
    for (const [key, values] of Object.entries(APPEARANCE)) {
        if (value?.[key] !== undefined && !values.some(([v])=>v===value[key])) throw Error('Некорректная внешность');
        out[key] = value?.[key] ?? out[key];
    }
    out.stubble = out.gender === 'male'; return out;
}
/** Cosmetic editor with a live rotating preview, apply/cancel and saved values. */
export function openAppearance(game, back = () => game.hud.closePanel(), initial = false) {
    let draft = normalizeLook(game.look), direction = 'down';
    const names = {gender:'Пол',hairStyle:'Причёска',skin:'Кожа',hair:'Волосы',coat:'Пальто',accent:'Шарф'};
    const show = () => {
        const rows = [{html:'<canvas id="appearancePreview" width="520" height="230" aria-label="Внешность персонажа"></canvas>'}];
        for (const [key,values] of Object.entries(APPEARANCE)) {
            const i = values.findIndex(([v])=>v===draft[key]);
            rows.push({label:`${names[key]}: ${values[i]?.[1] || values[0][1]}`,action:()=>{draft[key]=values[(i+1)%values.length][0];draft.stubble=draft.gender==='male';show();}});
        }
        rows.push({label:'Повернуть',action:()=>{const dirs=['down','left','up','right'];direction=dirs[(dirs.indexOf(direction)+1)%4];show();}},
            {label:initial?'Начать путь':'Применить',action:()=>{game.look=normalizeLook(draft);back();}},
            {label:initial?'Оставить предложенный образ':'Отмена',action:back});
        game.hud.openPanel(initial?'Тот, кто вернулся':'Внешность',rows,'appearance',{locked:initial});
        const canvas=game.hud.els.panelBody.querySelector('#appearancePreview'),ctx=canvas?.getContext?.('2d');
        if(ctx){ctx.clearRect(0,0,520,230);ctx.save();ctx.translate(260,212);ctx.scale(4.5,4.5);drawCharacter(ctx,{dir:direction,look:draft,idleTime:1});ctx.restore();}
    };
    show();
}
