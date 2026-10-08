package il.mesima.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class AlarmPlanTest {
    private val utc = ZoneId.of("UTC")
    private fun at(day: String, time: String = "00:00", zone: ZoneId = utc) =
        java.time.LocalDateTime.parse("${day}T$time").atZone(zone).toInstant().toEpochMilli()
    private fun rows(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it) }
    private fun repeat(time: String = "09:00") = JSONObject()
        .put("days", JSONArray(listOf(0, 1, 2, 3, 4, 5, 6))).put("times", JSONArray().put(time))
        .put("skipTypes", JSONArray()).put("skipScope", "day").put("around", false)
    private fun task(id: String = "habit") = JSONObject().put("id", id).put("title", "משימה")
        .put("kind", "short").put("repeat", repeat()).put("log", JSONObject()).put("checklists", JSONArray())
    private fun plan(vararg tasks: JSONObject) = JSONObject().put("schema", 1)
        .put("tasks", JSONArray(tasks.toList())).put("events", JSONArray())
    private fun event(id: String, date: String, time: String, end: String, endDate: String = date) =
        JSONObject().put("id", id).put("title", id).put("date", date).put("time", time)
            .put("end", end).put("endDate", endDate).put("typeId", "away").put("remindMin", JSONObject.NULL)

    @Test fun persistedRulesRenewBeyondTheOriginalWindowWithoutAnotherWebPublish() {
        val saved = AlarmPlan.validate(plan(task()).toString())
        val first = rows(AlarmPlan.build(saved, at("2026-10-08"), utc))
        val later = rows(AlarmPlan.build(JSONObject(saved.toString()), at("2027-02-08"), utc))
        assertEquals("2026-10-08", first.first().getString("day"))
        assertEquals("2027-02-08", later.first().getString("day"))
        assertTrue(later.all { it.getLong("at") > at("2027-02-08") })
        assertEquals("h_habit_2027-02-08@09:00", later.first().getString("id"))
    }

    @Test fun queueRefillsAndAllPeersAtOneTimestampSurviveTheSystemSlotCap() {
        val tasks = (0 until 150).map { task("habit_$it") }
        val saved = plan(*tasks.toTypedArray())
        val first = rows(AlarmPlan.build(saved, at("2026-10-08"), utc, 2))
        assertEquals(300, first.size)
        assertEquals(2, first.map { it.getLong("at") }.distinct().size)
        val later = rows(AlarmPlan.build(saved, at("2026-10-08", "09:01"), utc, 2))
        assertEquals(300, later.size)
        assertEquals(setOf("2026-10-09", "2026-10-10"), later.map { it.getString("day") }.toSet())
        val unblocked = rows(AlarmPlan.build(saved, at("2026-10-08"), utc, 1) { it.getString("day") == "2026-10-08" })
        assertEquals(150, unblocked.size)
        assertTrue(unblocked.all { it.getString("day") == "2026-10-09" })
    }

    @Test fun dailyCompletionAndUndoOnlyChangeTheTargetOccurrence() {
        val t = task().put("log", JSONObject().put("2026-10-08", 1))
        val saved = plan(t)
        assertEquals("2026-10-09", rows(AlarmPlan.build(saved, at("2026-10-08"), utc)).first().getString("day"))
        t.getJSONObject("log").remove("2026-10-08")
        assertEquals("2026-10-08", rows(AlarmPlan.build(saved, at("2026-10-08"), utc)).first().getString("day"))
    }

    @Test fun nullOptionalFieldsAndUndatedOneOffStayAnchoredAcrossMaintenance() {
        val t = task("one").put("repeat", JSONObject.NULL).put("planned", JSONObject.NULL)
            .put("reminder", JSONObject().put("type", "time").put("at", "09:00"))
        val raw = AlarmPlan.validate(plan(t).toString())
        val first = AlarmPlan.prepare(raw, null, at("2026-10-08", "10:00"), utc)
        assertEquals("2026-10-09", first.getJSONArray("tasks").getJSONObject(0).getString("_onceDay"))
        assertEquals(1, AlarmPlan.build(first, at("2026-10-08", "10:00"), utc).length())
        val republished = AlarmPlan.prepare(raw, first, at("2026-10-10"), utc)
        assertEquals(0, AlarmPlan.build(republished, at("2026-10-10"), utc).length())
        t.getJSONObject("reminder").put("at", "11:00")
        val edited = AlarmPlan.prepare(AlarmPlan.validate(plan(t).toString()), first, at("2026-10-10"), utc)
        assertEquals("2026-10-10", edited.getJSONArray("tasks").getJSONObject(0).getString("_onceDay"))
    }

    @Test fun exceptionEndAtMidnightIsExclusiveAndExplicitSameDayOvernightMatchesCalendar() {
        val t = task()
        t.getJSONObject("repeat").put("skipTypes", JSONArray().put("away"))
        val saved = plan(t).put("events", JSONArray().put(event("shift", "2026-10-08", "20:00", "00:00")))
        val normal = rows(AlarmPlan.build(saved, at("2026-10-08"), utc))
        assertFalse(normal.any { it.getString("day") == "2026-10-08" })
        assertTrue(normal.any { it.getString("day") == "2026-10-09" })
        t.getJSONObject("repeat").put("skipScope", "week")
        val weekly = rows(AlarmPlan.build(saved, at("2026-10-08"), utc))
        assertEquals("2026-10-11", weekly.first().getString("day"))
    }

    @Test fun delayedChecklistFollowUpKeepsOldCycleAndCompletionSurvivesRollover() {
        val c = JSONObject().put("id", "pack").put("name", "תיק").put("repeat", repeat("12:00").put("around", true))
            .put("cycle", "2026-10-08").put("complete", false).put("completedCycles", JSONArray())
        val saved = plan(task("project").put("kind", "long").put("repeat", JSONObject.NULL)
            .put("checklists", JSONArray().put(c)))
            .put("events", JSONArray().put(event("trip", "2026-10-01", "08:00", "13:00", "2026-10-08")))
        val overdueCycle = "ca_project_pack_2026-10-02@12:00"
        val open = rows(AlarmPlan.build(saved, at("2026-10-08", "14:00"), utc))
        assertEquals("2026-10-02", open.first { it.getString("id") == overdueCycle }.getString("occurrence"))
        assertEquals(at("2026-10-08", "15:00"), open.first { it.getString("id") == overdueCycle }.getLong("at"))
        c.put("completedCycles", JSONArray().put("2026-10-02"))
        assertFalse(rows(AlarmPlan.build(saved, at("2026-10-08", "14:00"), utc)).any { it.getString("id") == overdueCycle })
        c.put("completedCycles", JSONArray())
        assertTrue(rows(AlarmPlan.build(saved, at("2026-10-08", "14:00"), utc)).any { it.getString("id") == overdueCycle })
    }

    @Test fun preparationCanPrecedeTheFirstAllowedOccurrenceBeyondTheRollingWindow() {
        val t = task()
        t.getJSONObject("repeat").put("days", JSONArray().put(0)).put("around", true)
            .put("skipTypes", JSONArray().put("skip")).put("skipScope", "week")
        val saved = plan(t).put("events", JSONArray()
            .put(event("long-trip", "2026-10-09", "06:00", "20:00", "2026-10-27"))
            .put(event("exception", "2026-10-11", "00:00", "00:00").put("allDay", true).put("typeId", "skip")))
        val reminder = rows(AlarmPlan.build(saved, at("2026-10-08", "18:00"), utc))
            .first { it.getString("id") == "hp_habit_2026-10-18@09:00" }
        assertEquals(at("2026-10-09"), reminder.getLong("at"))
        assertEquals("2026-10-18", reminder.getString("day"))
    }

    @Test fun reusingAOneOffIdAtANewTimeOrChecklistOccurrenceSchedulesItAgain() {
        val t = task("once").put("repeat", JSONObject.NULL).put("planned", "2026-10-08")
            .put("reminder", JSONObject().put("type", "time").put("at", "09:00"))
        val c = JSONObject().put("id", "pack").put("name", "תיק").put("occurrence", "once-0")
            .put("once", JSONObject().put("date", "2026-10-08").put("time", "09:00")).put("complete", false)
        t.put("checklists", JSONArray().put(c))
        val saved = plan(t)
        assertEquals(2, AlarmPlan.build(saved, at("2026-10-08", "08:00"), utc).length())
        t.getJSONObject("reminder").put("at", "11:00")
        c.put("occurrence", "once-1").getJSONObject("once").put("time", "11:00")
        val next = rows(AlarmPlan.build(saved, at("2026-10-08", "10:00"), utc))
        assertEquals(2, next.size)
        assertTrue(next.all { it.getLong("at") == at("2026-10-08", "11:00") })
        assertEquals("once-1", next.first { it.getString("id") == "co_once_pack" }.getString("occurrence"))
    }

    @Test fun localReminderTimeSurvivesDaylightSavingAndFutureCalendarEventsAreNotTruncated() {
        val zone = ZoneId.of("America/New_York")
        val saved = plan(task()).put("events", JSONArray().put(event("future", "2027-05-01", "11:00", "12:00").put("remindMin", 30)))
        val future = rows(AlarmPlan.build(saved, at("2026-10-31", "00:00", zone), zone))
        val before = future.first { it.optString("day") == "2026-10-31" }
        val after = future.first { it.optString("day") == "2026-11-01" }
        assertEquals(25 * 3600000L, after.getLong("at") - before.getLong("at"))
        assertEquals(at("2027-05-01", "10:30", zone), future.first { it.getString("id") == "e_future" }.getLong("at"))
    }

    @Test fun malformedPlanIsRejectedBeforeReplacingTheSavedSchedule() {
        val malformed = plan(task())
        malformed.getJSONArray("tasks").getJSONObject(0).getJSONObject("repeat").put("times", JSONArray().put("29:00"))
        assertThrows(Exception::class.java) { AlarmPlan.validate(malformed.toString()) }
        assertThrows(Exception::class.java) { AlarmPlan.validate(plan(task(), task()).toString()) }
    }

    @Test fun widgetsRenewMonthsLaterWhileKeepingSelectionAndPendingCompletion() {
        val checklist = JSONObject().put("id", "pack").put("name", "תיק").put("repeat", repeat())
            .put("cycle", "2026-10-08").put("complete", true).put("completedCycles", JSONArray().put("2026-10-08"))
        val saved = plan(task(), task("project").put("kind", "long").put("repeat", JSONObject.NULL)
            .put("checklists", JSONArray().put(checklist)))
            .put("events", JSONArray().put(event("future", "2027-02-07", "22:00", "00:00", "2027-02-09")))
        val snapshot = JSONObject().put("tasks", JSONArray().put(JSONObject().put("id", "habit").put("daily", true).put("kind", "short"))
            .put(JSONObject().put("id", "project").put("kind", "long"))
            .put(JSONObject().put("id", "chosen").put("kind", "short").put("manualEligible", true)))
            .put("days", JSONObject()).put("widgets", JSONObject().put("7", JSONObject().put("ids", JSONArray().put("chosen"))))
        val renewed = AlarmPlan.widgetProjection(snapshot, saved, "2027-02-08", at("2027-02-08", "10:00"), utc)
        assertEquals(0, snapshot.getJSONObject("days").length()) // Pure presentation; no mirror mutation.
        val config = JSONObject().put("kind", "tasks").put("widgetId", 7)
        val open = WidgetModel.rows(renewed, JSONArray(), config, "2027-02-08", at("2027-02-08", "10:00"))
        assertTrue(open.any { it.optString("id") == "habit" })
        assertTrue(open.any { it.optString("id") == "cl_project_pack" })
        assertTrue(open.any { it.optString("id") == "chosen" })
        val pending = JSONArray().put(JSONObject().put("taskId", "habit").put("day", "2027-02-08").put("action", "complete"))
        assertFalse(WidgetModel.rows(renewed, pending, config, "2027-02-08").any { it.optString("id") == "habit" })
        val calendar = WidgetModel.rows(renewed, JSONArray(), JSONObject().put("kind", "calendar"), "2027-02-08")
        assertEquals(listOf("2027-02-08"), calendar.filter { it.optString("kind") == "event" }.map { it.getString("day") })
    }

    @Test fun widgetCycleSkipsALongExceptionWithoutInventingAnOpenFutureCycle() {
        val rep = repeat().put("skipTypes", JSONArray().put("away"))
        val checklist = JSONObject().put("id", "pack").put("name", "תיק").put("repeat", rep)
            .put("cycle", "2026-10-08").put("complete", true)
        val saved = plan(task("project").put("kind", "long").put("repeat", JSONObject.NULL)
            .put("checklists", JSONArray().put(checklist)))
            .put("events", JSONArray().put(event("leave", "2026-10-09", "00:00", "00:00", "2027-02-09")))
        val renewed = AlarmPlan.widgetProjection(JSONObject(), saved, "2027-02-08", at("2027-02-08", "10:00"), utc)
        val current = renewed.getJSONArray("widgetChecklists").getJSONObject(0)
        assertEquals("2026-10-08", current.getString("cycle"))
        assertTrue(current.getBoolean("complete"))
        val after = AlarmPlan.widgetProjection(JSONObject(), saved, "2027-02-09", at("2027-02-09", "10:00"), utc)
        assertEquals("2027-02-09", after.getJSONArray("widgetChecklists").getJSONObject(0).getString("cycle"))
        assertFalse(after.getJSONArray("widgetChecklists").getJSONObject(0).getBoolean("complete"))
    }
}
