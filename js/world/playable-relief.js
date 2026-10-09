/** Production home terrace: shared height, a walkable ramp and sheer faces.
 * No RNG, tile/prop edits or new save identities. Other zones remain unchanged.
 * A smooth base supports an explicit escarpment; movement, picking, faces
 * and feet all sample the same field. No bridges/overhangs yet. */
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
export class PlayableRelief {
    constructor(zone) {
        this.step = 16; this.maxHeight = 116;
        this.cols = Math.ceil(zone.map.widthPx / this.step) + 1;
        this.rows = Math.ceil(zone.map.heightPx / this.step) + 1;
        this.heights = new Float32Array(this.cols * this.rows);
        const field = zone.terrain;
        const hearth = zone.objects.find((o) => o.kind === "hearth_ruin") || zone.spawn;
        this.landmark = { x: hearth.x, y: hearth.y };
        this.ledge = { left: hearth.x-220, right:hearth.x+220, back:hearth.y-240, front:hearth.y+94, height:56,
            rampX:hearth.x, rampHalf:76, rampLength:150 };
        this.faces = [];
        for(let x=this.ledge.left;x<this.ledge.right;x+=8) {
            if(Math.abs(x+4-this.ledge.rampX)<this.ledge.rampHalf+8) continue;
            this.faces.push({x:x+4,y:this.frontAt(x+4),left:x,right:Math.min(this.ledge.right,x+8)});
        }
        for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) {
            const wx = x * this.step, wy = y * this.step;
            const sample = field.sample(wx, wy);
            const coast = Math.max(0, -(sample.coast ?? -200));
            const edge = smooth(Math.min(wx, wy, zone.map.widthPx - wx, zone.map.heightPx - wy) / 144);
            const bendX = (field.noise(wx, wy, 180, 6341) - .5) * 46;
            const bendY = (field.noise(wx, wy, 170, 6347) - .5) * 38;
            const distance = Math.hypot((wx - hearth.x + bendX) / 330, (wy - hearth.y + 20 + bendY) / 250);
            const shelf = smooth((1 - distance) / .52);
            const rolling = field.noise(wx, wy, 320, 6321) * 10;
            // Water stays level, with a bank broad enough not to fold projection.
            const height = sample.water >= .5 ? 0 : Math.min(rolling + shelf * 44, coast * .24);
            this.heights[y * this.cols + x] = height * edge;
        }
        // Bound both derivatives, including coast/build-floor discontinuities.
        // Four directional sweeps are a conservative Lipschitz envelope.
        const limit = this.step * .48;
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < this.heights.length; i++) {
                if (i % this.cols) this.heights[i] = Math.min(this.heights[i], this.heights[i - 1] + limit);
                if (i >= this.cols) this.heights[i] = Math.min(this.heights[i], this.heights[i - this.cols] + limit);
            }
            for (let i = this.heights.length - 1; i >= 0; i--) {
                if (i % this.cols < this.cols - 1 && i + 1 < this.heights.length) this.heights[i] = Math.min(this.heights[i], this.heights[i + 1] + limit);
                if (i + this.cols < this.heights.length) this.heights[i] = Math.min(this.heights[i], this.heights[i + this.cols] + limit);
            }
        }
    }
    baseHeightAt(x, y) {
        const gx = Math.max(0, Math.min(this.cols - 1.00001, x / this.step));
        const gy = Math.max(0, Math.min(this.rows - 1.00001, y / this.step));
        const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, i = iy * this.cols;
        const a = this.heights[i + ix] * (1 - fx) + this.heights[i + ix + 1] * fx;
        const b = this.heights[i + this.cols + ix] * (1 - fx) + this.heights[i + this.cols + ix + 1] * fx;
        return a * (1 - fy) + b * fy;
    }
    frontAt(x) { return this.ledge.front + Math.sin((x-this.landmark.x)*.022)*8 + Math.sin(x*.043)*3 + Math.sin(x*.11)*2; }
    extraHeight(x,y) {
        const l=this.ledge;
        if(x<l.left || x>l.right || y<l.back) return 0;
        const rise=smooth((y-l.back)/170), front=this.frontAt(x);
        const height=l.height + Math.sin(x*.043)*3 + Math.sin(x*.091)*2;
        if(y<=front) return height*rise;
        if(Math.abs(x-l.rampX)<=l.rampHalf && y<front+l.rampLength)
            return height*smooth((front+l.rampLength-y)/l.rampLength);
        return 0;
    }
    heightAt(x,y) { return this.baseHeightAt(x,y)+this.extraHeight(x,y); }
    contactAt(x,y,r=9) {
        const h=this.heightAt(x,y);
        let nx=0,ny=0,hits=0;
        for(let i=0;i<12;i++) { const a=i*Math.PI/6;
            if(Math.abs(this.heightAt(x+Math.cos(a)*r,y+Math.sin(a)*r)-h)>12) {nx-=Math.cos(a);ny-=Math.sin(a);hits++;}
        }
        if(!hits) return null;
        const length=Math.hypot(nx,ny)||1;
        return {nx:nx/length,ny:ny/length,r:1000,depth:1};
    }
    canStand(x,y,r=9) { return !this.contactAt(x,y,r); }
    unprojectY(x,base) {
        // Multiple projected roots can exist behind a cliff. Pick the foremost
        // visible floor, never interpret the wall as a walkable slope.
        let best=base, error=Infinity;
        for(let y=base;y<=base+this.maxHeight;y+=.5) {
            const e=Math.abs(y-this.heightAt(x,y)-base);
            if(e<=error) {best=y;error=e;}
        }
        for(let i=0;i<12;i++) {
            const error=best-this.heightAt(x,best)-base;
            const derivative=1-(this.heightAt(x,best+.01)-this.heightAt(x,best-.01))/.02;
            if(Math.abs(derivative)<.01) break;
            const step=error/derivative;if(Math.abs(step)>2) break;best-=step;
        }
        return best;
    }
    canReach(a, b) { return Math.abs(this.heightAt(a.x, a.y) - this.heightAt(b.x, b.y)) <= 12; }
}
export function installPlayableRelief(zone) {
    if (zone.id !== "ashfall") return;
    zone.playableRelief = new PlayableRelief(zone);
    zone.terrain.projected = true;
    zone.terrain.shadeElevation = (x,y) => zone.playableRelief.baseHeightAt(x,y);
    zone.terrain.elevation = (x, y) => zone.playableRelief.heightAt(x, y);
}
