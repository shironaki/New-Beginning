/**
 * tools/png-decode.js — минимальное чтение PNG (8 бит, без чересстрочности).
 * Нужен ровно один сценарий: взять текстуру пака и получить RGBA-пиксели для
 * программного рендера в tools/hero-bake.js. zlib — встроенный, зависимостей нет.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const COLOR_TYPES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function decodePng(buffer) {
    if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("не PNG");
    // Сигнатура 8 байт, затем длина(4)+type(4) чанка IHDR → данные начинаются с 16.
    if (buffer.toString("ascii", 12, 16) !== "IHDR") throw new Error("PNG: IHDR не первый чанк");
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const depth = buffer[24];
    const colorType = buffer[25];
    const interlace = buffer[28];
    if (depth !== 8) throw new Error(`PNG: поддерживается только 8 бит, а тут ${depth}`);
    if (interlace) throw new Error("PNG: чересстрочная развёртка не поддерживается");
    const channels = COLOR_TYPES[colorType];
    if (!channels) throw new Error(`PNG: неизвестный colorType ${colorType}`);

    const idat = [];
    let off = 8;
    let palette = null;
    while (off + 8 <= buffer.length) {
        const len = buffer.readUInt32BE(off);
        const type = buffer.toString("ascii", off + 4, off + 8);
        const start = off + 8;
        if (type === "IDAT") idat.push(buffer.subarray(start, start + len));
        else if (type === "PLTE") palette = buffer.subarray(start, start + len);
        else if (type === "IEND") break;
        off = start + len + 4;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const out = Buffer.alloc(height * stride);

    let pos = 0;
    for (let y = 0; y < height; y += 1) {
        const filter = raw[pos]; pos += 1;
        const rowStart = y * stride;
        const prevStart = (y - 1) * stride;
        for (let x = 0; x < stride; x += 1) {
            const value = raw[pos + x];
            const a = x >= channels ? out[rowStart + x - channels] : 0;
            const b = y > 0 ? out[prevStart + x] : 0;
            const c = (x >= channels && y > 0) ? out[prevStart + x - channels] : 0;
            let outValue;
            switch (filter) {
                case 0: outValue = value; break;
                case 1: outValue = value + a; break;
                case 2: outValue = value + b; break;
                case 3: outValue = value + ((a + b) >> 1); break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    outValue = value + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
                    break;
                }
                default: throw new Error(`PNG: неизвестный фильтр ${filter}`);
            }
            out[rowStart + x] = outValue & 0xff;
        }
        pos += stride;
    }

    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, p = 0; i < width * height; i += 1, p += channels) {
        if (colorType === 6) {
            rgba[i * 4] = out[p]; rgba[i * 4 + 1] = out[p + 1];
            rgba[i * 4 + 2] = out[p + 2]; rgba[i * 4 + 3] = out[p + 3];
        } else if (colorType === 2) {
            rgba[i * 4] = out[p]; rgba[i * 4 + 1] = out[p + 1];
            rgba[i * 4 + 2] = out[p + 2]; rgba[i * 4 + 3] = 255;
        } else if (colorType === 0) {
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[p]; rgba[i * 4 + 3] = 255;
        } else if (colorType === 4) {
            rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[p]; rgba[i * 4 + 3] = out[p + 1];
        } else if (colorType === 3 && palette) {
            const idx = out[p] * 3;
            rgba[i * 4] = palette[idx]; rgba[i * 4 + 1] = palette[idx + 1];
            rgba[i * 4 + 2] = palette[idx + 2]; rgba[i * 4 + 3] = 255;
        }
    }
    return { width, height, data: rgba };
}

export function loadPngFile(file) { return decodePng(fs.readFileSync(file)); }
