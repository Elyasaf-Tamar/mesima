package il.mesima.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BackupsTest {
    @Test fun validatesLegacyAndImageDataWithoutChangingIt() {
        val text="""{"v":10,"tasks":[{"id":"a","img":"data:image/png;base64,aGVsbG8="}],"notes":[],"events":[]}"""
        assertEquals("data:image/png;base64,aGVsbG8=", Backups.validate(text).getJSONArray("tasks").getJSONObject(0).getString("img"))
        assertEquals(0, Backups.validate("""{"tasks":[]}""").getJSONArray("tasks").length())
    }
    @Test fun rejectsMalformedOrWrongShapeBackup() {
        for(text in listOf("broken", "{}", """{"tasks":null}""", """{"tasks":[],"notes":{}}""")) {
            assertThrows(Exception::class.java) { Backups.validate(text) }
        }
    }
    @Test fun refusesOversizedSnapshot() {
        assertThrows(IllegalArgumentException::class.java) {
            Backups.validate(" ".repeat(Backups.MAX_BYTES + 1))
        }
    }
    @Test fun nativeCommandsArePreservedWithoutChangingTheMirrorOrInputQueue() {
        val source="""{"v":12,"tasks":[{"id":"a","done":false}],"completions":[]}"""
        val commands=org.json.JSONArray("""[{"id":"command","action":"complete","taskId":"a","day":"2026-10-08","at":1}]""")
        val backup=Backups.validate(Backups.withActions(source,commands))
        assertEquals(false,backup.getJSONArray("tasks").getJSONObject(0).getBoolean("done"))
        assertEquals(1,backup.getJSONObject("nativeActions").getInt("schema"))
        assertEquals("command",backup.getJSONObject("nativeActions").getJSONArray("commands").getJSONObject(0).getString("id"))
        assertEquals(0,backup.getJSONArray("completions").length())
        assertEquals(1,commands.length())
        assertEquals(source,Backups.withActions(source,org.json.JSONArray()))
    }
}
