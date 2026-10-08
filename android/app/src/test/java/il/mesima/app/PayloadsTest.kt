package il.mesima.app

import java.io.ByteArrayInputStream
import org.junit.Assert.*
import org.junit.Test

class PayloadsTest {
    @Test fun limitsUtf8BytesRatherThanCharacters() {
        assertEquals(4, Payloads.bytes("אב", 4).size)
        assertThrows(IllegalArgumentException::class.java) { Payloads.bytes("אבג", 4) }
    }

    @Test fun boundedReaderRejectsOversizeWhileReadingAndAcceptsExactBoundary() {
        assertEquals("abcd", Payloads.readText(ByteArrayInputStream("abcd".toByteArray()), 4))
        assertThrows(IllegalArgumentException::class.java) {
            Payloads.read(ByteArrayInputStream("abcde".toByteArray()), 4)
        }
    }

    @Test fun malformedUtf8IsNotSilentlyReplaced() {
        assertThrows(java.nio.charset.CharacterCodingException::class.java) {
            Payloads.text(byteArrayOf(0xC3.toByte(), 0x28))
        }
    }
}
