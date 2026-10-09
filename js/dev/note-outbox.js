/** Local receipt journal. A reachable server is NOT a delivery receipt.
 * Keep text/context after delivery, never silently truncate a long session.
 * On quota pressure sacrifice pictures, not the owner's reports. */
export const noteKey = (note) => JSON.stringify([note.at, note.zone, note.x, note.y, note.text]);
export class NoteOutbox {
    constructor(storage, key) {
        this.storage = storage; this.key = key; this.running = null;
        this.notes = []; this.lastError = ""; this.picturesDropped = false;
        try {
            const data = JSON.parse(storage.getItem(key) || "[]");
            if (!Array.isArray(data)) throw Error("not a note list");
            this.notes = data;
            this.picturesDropped = data.some((n) => n.shotOmitted);
        } catch { this.lastError = "Не удалось прочитать архив заметок. Старая запись не перезаписана."; this.unreadable = true; }
    }
    all() { return this.notes.slice(); }
    read() { return this.notes.filter((n) => !n.delivery?.pushed); }
    write() {
        if (this.unreadable) return false;
        try { this.storage.setItem(this.key, JSON.stringify(this.notes)); this.lastError = ""; return true; }
        catch {
            const textOnly = this.notes.map(({ shot, ...note }) => ({ ...note, ...(shot ? { shotOmitted: true } : {}) }));
            try {
                this.storage.setItem(this.key, JSON.stringify(textOnly));
                this.notes = textOnly; this.picturesDropped = true; this.lastError = ""; return true;
            } catch { this.lastError = "Хранилище недоступно. Выгрузи заметки файлом до закрытия страницы."; return false; }
        }
    }
    push(note) {
        const key = noteKey(note);
        if (!this.notes.some((n) => noteKey(n) === key)) this.notes.push(note);
        return this.write();
    }
    flush(post) {
        if (this.running) return this.running;
        this.running = this._flush(post).finally(() => { this.running = null; });
        return this.running;
    }
    async _flush(post) {
        let sent = 0;
        for (const note of this.read()) {
            let receipt;
            try { receipt = await post(note); } catch { break; }
            if (receipt?.ok !== true || receipt.pushed !== true || !receipt.file) break;
            const current = this.notes.find((n) => noteKey(n) === noteKey(note));
            if (current) current.delivery = { file: receipt.file, pushed: true, at: new Date().toISOString() };
            this.write(); sent++;
        }
        return sent;
    }
    clearDelivered() { this.notes = this.read(); return this.write(); }
}
