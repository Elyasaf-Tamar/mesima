package il.mesima.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.TreeMap

/** Durable scheduling rules. The OS holds a bounded queue; these rules refill it.
 * Dates use the device's current zone, matching the web calendar's local dates.
 * Equal trigger times share a system alarm, so the queue cap never drops peers. */
object AlarmPlan {
    const val SCHEMA = 1
    const val WINDOW_DAYS = 8L
    const val PRE = 6 * 3600000L
    const val POST = 2 * 3600000L
    private fun objects(a: JSONArray?) = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }
    private fun strings(a: JSONArray?) = (0 until (a?.length() ?: 0)).map { a!!.getString(it) }
    // Android's JSONObject may stringify explicit JSON null as "null". Optional
    // plan fields cross the bridge as null; keep them distinct from actual text.
    private fun string(o: JSONObject, key: String, fallback: String = "") = if (o.isNull(key)) fallback else o.optString(key, fallback)
    private fun time(value: String) = LocalTime.parse(value)
    private fun date(value: String) = LocalDate.parse(value)
    private fun at(day: LocalDate, hm: String, zone: ZoneId) = day.atTime(time(hm)).atZone(zone).toInstant().toEpochMilli()
    private fun times(rep: JSONObject) = (rep.optJSONArray("times")?.let { strings(it) }
        ?: rep.optString("time").takeIf { it.isNotBlank() }?.let { listOf(it) } ?: emptyList()).distinct().sorted()

    private fun validateRepeat(rep: JSONObject?) {
        if (rep == null) return
        val days = rep.getJSONArray("days")
        require(days.length() <= 7 && (0 until days.length()).all { days.getInt(it) in 0..6 })
        val hours = times(rep)
        require(hours.size <= 1440)
        hours.forEach { time(it) }
        strings(rep.optJSONArray("skipTypes"))
    }

    fun validate(text: String): JSONObject {
        Payloads.bytes(text)
        val plan = JSONObject(text)
        require(plan.getInt("schema") == SCHEMA)
        val tasks = plan.getJSONArray("tasks")
        val events = plan.getJSONArray("events")
        require(objects(tasks).size == tasks.length() && objects(events).size == events.length())
        val taskIds = mutableSetOf<String>()
        for (t in objects(tasks)) {
            val id = t.getString("id"); require(id.isNotBlank() && id.length <= 500 && taskIds.add(id))
            if (string(t, "planned").isNotBlank()) date(t.getString("planned"))
            t.optJSONObject("reminder")?.takeIf { it.optString("type") == "time" }?.let { time(it.getString("at")) }
            validateRepeat(t.optJSONObject("repeat"))
            for (c in objects(t.optJSONArray("checklists"))) {
                require(c.getString("id").isNotBlank())
                validateRepeat(c.optJSONObject("repeat"))
                c.optJSONObject("once")?.let { once ->
                    if (string(once, "date").isNotBlank()) date(once.getString("date"))
                    if (string(once, "time").isNotBlank()) time(once.getString("time"))
                }
            }
        }
        val eventIds = mutableSetOf<String>()
        for (e in objects(events)) {
            require(e.getString("id").isNotBlank() && eventIds.add(e.getString("id")))
            date(e.getString("date"))
            if (string(e, "endDate").isNotBlank()) require(date(e.getString("endDate")) >= date(e.getString("date")))
            if (!e.optBoolean("allDay")) { time(string(e, "time", "00:00")); time(string(e, "end").ifBlank { string(e, "time", "00:00") }) }
        }
        return plan
    }

    /** Old HTML can supply undated one-off reminders. Anchor them once, including
     * across unrelated edits and process restarts; upkeep must not make them daily. */
    fun prepare(input: JSONObject, previous: JSONObject?, now: Long, zone: ZoneId): JSONObject {
        val plan = JSONObject(input.toString())
        val old = objects(previous?.optJSONArray("tasks")).associateBy { it.optString("id") }
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        for (t in objects(plan.optJSONArray("tasks"))) {
            val r = t.optJSONObject("reminder") ?: continue
            if (r.optString("type") != "time" || string(t, "planned").isNotBlank() || t.optJSONObject("repeat") != null) continue
            val p = old[t.optString("id")]
            val previousDay = p?.optString("_onceDay").orEmpty()
            val unchanged = previousDay.isNotBlank() && (p == null || string(p, "planned").isBlank()) &&
                p?.optJSONObject("reminder")?.optString("at") == r.optString("at") && p?.optLong("resumeAt") == t.optLong("resumeAt")
            val day = if (unchanged) previousDay else (if (at(today, r.getString("at"), zone) > now) today else today.plusDays(1)).toString()
            t.put("_onceDay", day)
        }
        return plan
    }

    private data class Event(val value: JSONObject, val start: Long, val end: Long, val allDay: Boolean)
    private fun event(e: JSONObject, zone: ZoneId): Event {
        val day = date(e.getString("date")); val last = string(e, "endDate").takeIf { it.isNotBlank() }?.let { date(it) } ?: day
        val allDay = e.optBoolean("allDay")
        val start = if (allDay) day.atStartOfDay(zone).toInstant().toEpochMilli() else at(day, string(e, "time", "00:00"), zone)
        var end = if (allDay) last.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            else at(last, string(e, "end").ifBlank { string(e, "time", "00:00") }, zone)
        if (!allDay && end <= start && last == day) end = at(last.plusDays(1), string(e, "end").ifBlank { string(e, "time", "00:00") }, zone)
        if (end <= start) end = start + 3600000
        return Event(e, start, end, allDay)
    }

    private fun due(rep: JSONObject, day: LocalDate, events: List<Event>, zone: ZoneId): Boolean {
        val days = rep.optJSONArray("days") ?: return false
        if ((0 until days.length()).none { days.optInt(it, -1) == day.dayOfWeek.value % 7 }) return false
        return blockers(rep, day, events, zone).isEmpty()
    }

    private fun blockers(rep: JSONObject, day: LocalDate, events: List<Event>, zone: ZoneId): List<Event> {
        val skip = strings(rep.optJSONArray("skipTypes")).toSet()
        if (skip.isEmpty()) return emptyList()
        val first = if (rep.optString("skipScope") == "week") day.minusDays((day.dayOfWeek.value % 7).toLong()) else day
        val start = first.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = first.plusDays(if (rep.optString("skipScope") == "week") 7 else 1).atStartOfDay(zone).toInstant().toEpochMilli()
        return events.filter { it.value.optString("typeId") in skip && it.start < end && it.end > start }
    }

    /** Find an earlier cycle by jumping over finite exception ranges, so widget
     * renewal also works after a long trip or months without opening the app. */
    private fun findDue(rep: JSONObject, from: LocalDate, events: List<Event>, zone: ZoneId, direction: Long): LocalDate? {
        val days = rep.optJSONArray("days") ?: return null
        if (days.length() == 0 || times(rep).isEmpty()) return null
        var day = from
        repeat(events.size + 2) {
            for (i in 0..6) {
                if ((0 until days.length()).any { days.optInt(it) == day.dayOfWeek.value % 7 }) break
                day = day.plusDays(direction)
            }
            val blocked = blockers(rep, day, events, zone)
            if (blocked.isEmpty()) return day
            day = if (direction > 0) blocked.maxOf { Instant.ofEpochMilli(it.end - 1).atZone(zone).toLocalDate() }
                else blocked.minOf { Instant.ofEpochMilli(it.start).atZone(zone).toLocalDate() }
            if (rep.optString("skipScope") == "week") {
                day = day.minusDays((day.dayOfWeek.value % 7).toLong())
                if (direction > 0) day = day.plusDays(6)
            }
            day = day.plusDays(direction)
        }
        return null
    }

    private fun cycleAt(rep: JSONObject, now: Long, events: List<Event>, zone: ZoneId): LocalDate? {
        val hm = times(rep).firstOrNull() ?: return null
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        for (day in listOf(today.plusDays(1), today)) {
            if (due(rep, day, events, zone) && at(day, hm, zone) - PRE <= now) return day
        }
        return findDue(rep, today.minusDays(1), events, zone, -1)
    }

    /** Renew only the task/calendar presentation. Widget selection, note privacy,
     * shopping data and the original projected task state remain unchanged. */
    fun widgetProjection(snapshot: JSONObject, plan: JSONObject, day: String, now: Long,
                         zone: ZoneId = ZoneId.systemDefault()): JSONObject {
        val result = JSONObject()
        snapshot.keys().forEach { result.put(it, snapshot.get(it)) }
        val events = objects(plan.optJSONArray("events")).map { event(it, zone) }
        val tasks = objects(plan.optJSONArray("tasks")).filter { !it.optBoolean("done") && !it.optBoolean("archived") }
        val descriptions = objects(snapshot.optJSONArray("tasks")).associateBy { it.optString("id") }
        val start = date(day)
        val days = JSONObject()
        repeat(7) { offset ->
            val date = start.plusDays(offset.toLong())
            val key = date.toString()
            val from = date.atStartOfDay(zone).toInstant().toEpochMilli()
            val until = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            val rows = mutableListOf<Pair<String, JSONObject>>()
            for (e in events.filter { it.start < until && it.end > from }) {
                rows.add(string(e.value, "time") to JSONObject().put("id", e.value.getString("id"))
                    .put("kind", "event").put("title", string(e.value, "title"))
                    .put("time", if (e.allDay) "כל היום" else string(e.value, "time"))
                    .put("detail", string(e.value, "note")).put("check", false))
            }
            for (t in tasks) {
                val rep = t.optJSONObject("repeat")
                val habit = rep != null && times(rep).isNotEmpty()
                if (if (habit) !due(rep!!, date, events, zone) else string(t, "planned") != key) continue
                if (habit && (t.optJSONObject("log")?.optInt(key, 0) ?: 0) > 0) continue
                val hm = if (habit) {
                    val hours = times(rep!!)
                    val current = Instant.ofEpochMilli(now).atZone(zone)
                    (if (date == current.toLocalDate()) hours.firstOrNull { it >= current.toLocalTime().toString().take(5) } else null) ?: hours.first()
                } else t.optJSONObject("reminder")?.takeIf { it.optString("type") == "time" }?.optString("at").orEmpty()
                rows.add(hm to JSONObject().put("id", t.getString("id")).put("kind", "task")
                    .put("title", string(t, "title")).put("time", hm).put("check", t.optString("kind") == "short")
                    .put("detail", descriptions[t.getString("id")]?.optString("parentNames").orEmpty()))
            }
            days.put(key, JSONArray(rows.sortedWith(compareBy { it.first.ifBlank { "\uffff" } }).map { it.second }))
        }
        val checklists = JSONArray()
        for (t in tasks) for (c in objects(t.optJSONArray("checklists"))) {
            val rep = c.optJSONObject("repeat") ?: continue
            val hm = times(rep).firstOrNull() ?: continue
            val original = string(c, "cycle")
            val computed = cycleAt(rep, now, events, zone)?.toString().orEmpty()
            val cycle = maxOf(original, computed)
            if (cycle.isBlank()) continue
            val complete = cycle in strings(c.optJSONArray("completedCycles")) || (cycle == original && c.optBoolean("complete"))
            checklists.put(JSONObject().put("id", "cl_${t.getString("id")}_${c.getString("id")}")
                .put("taskId", t.getString("id")).put("title", string(c, "name"))
                .put("cycle", cycle).put("complete", complete).put("time", hm).put("slots", JSONArray()))
        }
        return result.put("days", days).put("widgetChecklists", checklists)
    }

    /** Returns all occurrences in the nearest [slots] distinct trigger times.
     * Scheduled recurrence rolls forward on every alarm and maintenance wakeup.
     * Completed daily/checklist occurrences remain suppressed after cycle rollover. */
    fun build(plan: JSONObject, now: Long, zone: ZoneId = ZoneId.systemDefault(), slots: Int = 100,
              blocked: (JSONObject) -> Boolean = { false }): JSONArray {
        require(slots > 0)
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val until = today.plusDays(WINDOW_DAYS).atStartOfDay(zone).toInstant().toEpochMilli()
        val events = objects(plan.optJSONArray("events")).map { event(it, zone) }.sortedBy { it.value.optString("time") }
        val buckets = TreeMap<Long, LinkedHashMap<String, JSONObject>>()
        val rowSizes = mutableMapOf<String, Int>()
        var queuedBytes = 2L
        fun add(id: String, whenMs: Long, title: String, body: String, meta: JSONObject) {
            if (whenMs <= now) return
            if (buckets.size >= slots && whenMs > buckets.lastKey()) return
            val row = JSONObject(meta.toString()).put("id", id).put("at", whenMs).put("title", title).put("body", body)
            if (blocked(row)) return // A completed occurrence must not consume a queue slot.
            val size = Payloads.bytes(row.toString()).size + 1
            queuedBytes += size - (rowSizes.put(id, size) ?: 0)
            buckets.getOrPut(whenMs) { linkedMapOf() }[id] = row
            if (buckets.size > slots) {
                val discarded = buckets.pollLastEntry()?.value.orEmpty()
                for (removed in discarded.keys) queuedBytes -= rowSizes.remove(removed) ?: 0
            }
            require(queuedBytes <= Payloads.MAX_BYTES) { "רשימת התזכורות גדולה מדי לשמירה במכשיר (20 MB)" }
        }
        fun body(note: String, detail: String) = listOf(note.trim(), detail).filter { it.isNotBlank() }.joinToString("\n\n")

        for (t in objects(plan.optJSONArray("tasks"))) {
            if (t.optBoolean("done") || t.optBoolean("archived")) continue
            val id = t.getString("id"); val title = t.optString("title", "משימה"); val note = t.optString("note")
            val rep = t.optJSONObject("repeat")
            fun recurring(r: JSONObject, c: JSONObject?) {
                val ranges = mutableListOf(today.minusDays(1) to today.plusDays(WINDOW_DAYS))
                // Prep can concern an occurrence far into a long event; follow-up
                // can concern an older cycle. Reconstruct either as its trigger
                // approaches, even without a WebView or after a device reboot.
                if (r.optBoolean("around")) for (ev in events) {
                    if (ev.allDay) continue
                    val preparing = ev.start - PRE > now && ev.start - PRE <= until
                    val following = ev.end + POST > now && ev.end + POST <= until
                    if (!preparing && !following) continue
                    val first = Instant.ofEpochMilli(ev.start).atZone(zone).toLocalDate()
                    val last = Instant.ofEpochMilli(ev.end - 1).atZone(zone).toLocalDate()
                    ranges.add(first to if (preparing) last else minOf(today.minusDays(1), last))
                }
                val merged = mutableListOf<Pair<LocalDate, LocalDate>>()
                for (range in ranges.filter { it.first <= it.second }.sortedBy { it.first }) {
                    val last = merged.lastOrNull()
                    if (last != null && range.first <= last.second.plusDays(1)) merged[merged.lastIndex] = last.first to maxOf(last.second, range.second)
                    else merged.add(range)
                }
                val candidates = sequence {
                    for ((first, last) in merged) {
                        var day = first
                        while (day <= last) {
                            val next = findDue(r, day, events, zone, 1) ?: break
                            if (next > last) break
                            yield(next)
                            day = next.plusDays(1)
                        }
                    }
                }
                val completed = strings(c?.optJSONArray("completedCycles")).toSet()
                for (d in candidates) {
                    val key = d.toString()
                    if (c == null && (t.optJSONObject("log")?.optInt(key, 0) ?: 0) > 0) continue
                    if (c != null && (key in completed || (c.optBoolean("complete") && key <= c.optString("cycle")))) continue
                    for (hm in times(r)) {
                        val whenMs = at(d, hm, zone)
                        val meta = JSONObject().put("taskId", id).put("day", key).put("kind", if(c == null) "task" else "checklist")
                        if (c == null) meta.put("daily", true) else meta.put("checklistId", c.getString("id")).put("occurrence", key)
                        val suffix = id + (c?.let { "_" + it.getString("id") } ?: "") + "_" + key + "@" + hm
                        val label = c?.optString("name") ?: title
                        val ev = if (r.optBoolean("around")) events.firstOrNull { !it.allDay && whenMs >= it.start && whenMs < it.end } else null
                        if (ev != null) {
                            add((if(c == null) "hp_" else "cp_") + suffix, ev.start - PRE, label, body(note, "שים לב — יש לך אירוע בזמן הזה. תיערך בהתאם."), meta)
                            add((if(c == null) "ha_" else "ca_") + suffix, ev.end + POST, label, body(note, "שים לב — היית אמור לעשות את זה."), meta)
                        } else {
                            val detail = if(c == null) "תזכורת יומית $hm" else "${c.optInt("left")} פריטים פתוחים · $title"
                            add((if(c == null) "h_" else "c_") + suffix, whenMs, label, body(note, detail), meta)
                        }
                    }
                }
            }
            if (rep != null && times(rep).isNotEmpty() && t.optString("kind") != "long") recurring(rep, null)
            else if (t.optString("kind") != "long") {
                val r = t.optJSONObject("reminder")
                val day = string(t, "planned").ifBlank { string(t, "_onceDay") }
                if (r?.optString("type") == "time" && day.isNotBlank()) {
                    add("t_${id}_$day", at(date(day), r.getString("at"), zone), title, body(note, "הגיע הזמן — ${r.getString("at")}"),
                        JSONObject().put("taskId", id).put("day", day).put("kind", "task").put("daily", false))
                }
            }
            for (c in objects(t.optJSONArray("checklists"))) {
                val r = c.optJSONObject("repeat")
                if (r != null && times(r).isNotEmpty()) { recurring(r, c); continue }
                val once = c.optJSONObject("once") ?: continue
                if (c.optBoolean("complete") || string(once, "date").isBlank() || string(once, "time").isBlank()) continue
                val day = once.getString("date")
                add("co_${id}_${c.getString("id")}", at(date(day), once.getString("time"), zone), c.optString("name"), body(note, "${c.optInt("left")} פריטים פתוחים · $title"),
                    JSONObject().put("taskId", id).put("day", day).put("kind", "checklist").put("checklistId", c.getString("id")).put("occurrence", c.optString("occurrence").ifBlank { "once-0" }))
            }
        }
        for (ev in events) {
            val e = ev.value
            if (e.isNull("remindMin") || e.optInt("remindMin", -1) < 0 || e.optLong("firedAt") > 0) continue
            val base = if (ev.allDay) at(date(e.getString("date")), "09:00", zone) else ev.start
            val whenMs = base - e.optInt("remindMin") * 60000L
            add("e_" + e.getString("id"), whenMs, e.optString("title"), body(e.optString("note"), if(ev.allDay) "אירוע של יום שלם" else "מתחיל ב־" + e.optString("time")),
                JSONObject().put("kind", "event").put("eventId", e.getString("id")))
        }
        return JSONArray(buckets.values.flatMap { it.values })
    }
}
