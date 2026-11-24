/** Project once while baking, not thousands of mesh draws every frame.
 * Monotone y-height surface permits column rasterisation with no holes.
 * Props/feet use the same exact height; quantisation is just the texture pixel.
 * Transparent padding lets adjacent chunks meet at the same world contour. */
export function projectGround(source, field, ox, oy) {
    const size = source.width, lift = Math.ceil(field.maxHeight) + 1;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size + lift + 1; canvas.groundLift = lift;
    const src = source.getContext("2d").getImageData(0, 0, size, size).data;
    const ctx = canvas.getContext("2d"), image = ctx.createImageData(canvas.width, canvas.height);
    const dest = image.data;
    for (let x = 0; x < size; x++) {
        const wx = ox + x + .5;
        let top = Math.round(lift - field.heightAt(wx, oy));
        for (let y = 0; y < size; y++) {
            const bottom = Math.round(y + 1 + lift - field.heightAt(wx, oy + y + 1));
            const from = (y * size + x) * 4;
            for (let py = top; py < bottom; py++) {
                if (py < 0 || py >= canvas.height) continue;
                const to = (py * size + x) * 4;
                dest[to] = src[from]; dest[to + 1] = src[from + 1]; dest[to + 2] = src[from + 2]; dest[to + 3] = src[from + 3];
            }
            top = bottom;
        }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
}
