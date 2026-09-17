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
}
