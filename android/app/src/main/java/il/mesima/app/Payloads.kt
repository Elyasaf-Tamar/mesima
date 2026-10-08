package il.mesima.app

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** One byte limit for saved data, external restores and the native projection. */
object Payloads {
    const val MAX_BYTES = 20 * 1024 * 1024

    fun bytes(text: String, limit: Int = MAX_BYTES): ByteArray {
        require(text.length <= limit) { "הקובץ גדול מהמגבלה של ${limit / 1024 / 1024}MB" }
        val bytes = text.toByteArray(Charsets.UTF_8)
        require(bytes.size <= limit) { "הקובץ גדול מהמגבלה של ${limit / 1024 / 1024}MB" }
        return bytes
    }

    fun read(input: InputStream, limit: Int = MAX_BYTES): ByteArray {
        val output = ByteArrayOutputStream(minOf(limit, 8192))
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            require(output.size().toLong() + count <= limit) { "הקובץ גדול מהמגבלה של ${limit / 1024 / 1024}MB" }
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    fun text(bytes: ByteArray): String = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes)).toString()

    fun readText(input: InputStream, limit: Int = MAX_BYTES): String = text(read(input, limit))
}
