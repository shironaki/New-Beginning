import { startPickup, tickHands } from '../js/ui/hands.js';
export function reach(g,o) { g.player.x=o.x;g.player.y=o.y+18; }
export function collect(g,o) {
    reach(g,o);
    for(let i=0;i<30 && o.loot?.length;i++) {
        g.storyNotices.length=0;g.hud.hideStory();
        if(!g.inventory.handAction) startPickup(g,o);
        tickHands(g,1);
    }
}
