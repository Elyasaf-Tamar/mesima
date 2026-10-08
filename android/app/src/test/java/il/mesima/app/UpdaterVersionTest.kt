package il.mesima.app
import org.junit.Test
import org.junit.Assert.*
class UpdaterVersionTest {
 @Test fun replacementPublishesACompletePageAndCleansTemporaryFiles(){
  val directory=java.nio.file.Files.createTempDirectory("mesima-ota-test-").toFile()
  try{
   val file=java.io.File(directory,"index.html");file.writeText("previous complete page")
   val next="new complete page".repeat(1000).toByteArray()
   Updater.writeAtomic(file,next)
   assertArrayEquals(next,file.readBytes())
   assertEquals(listOf("index.html"),directory.listFiles()!!.map{it.name})
  }finally{directory.deleteRecursively()}
 }
 @Test fun newerBundleCannotBeReplacedByOldServerContent(){
  assertTrue(Updater.contentVersion("const BUILD = '4.7 · 2026-09-15';")>Updater.contentVersion("const BUILD = '4.6 · 2026-09-06';"))
  assertTrue(Updater.contentVersion("const BUILD = '4.10';")>Updater.contentVersion("const BUILD = '4.9';"))
  assertTrue(Updater.contentVersion("const BUILD = '4.7.1';")>Updater.contentVersion("const BUILD = '4.7';"))
  assertTrue(Updater.contentVersion("const BUILD = '4.8';")>Updater.contentVersion("const BUILD = '4.7.12';"))
  assertEquals(0L,Updater.contentVersion("<html>error</html>"))
 }
 @Test fun nativeBoundaryRejectsUnsafeSourcesAndAcceptsHttpsRedirectTargets(){
  assertEquals("example.org",Updater.checkedUrl("https://example.org/app/index.html?v=4").host)
  for(url in listOf("http://example.org/app","https://user:secret@example.org/app","file:///app","https://example.org:8080/app","https://example.org/app#fragment")){
   assertThrows(Exception::class.java){Updater.checkedUrl(url)}
  }
 }
 @Test fun htmlErrorPagesCannotReplaceApplication(){
  val padding=" ".repeat(2100)
  assertThrows(IllegalArgumentException::class.java){Updater.validateContent(("<html>error</html>"+padding).toByteArray())}
  assertThrows(IllegalArgumentException::class.java){Updater.validateContent(("<html>const BUILD='4.9.2';</html>"+padding).toByteArray())}
  val app="<html><nav id='nav'></nav><script>const BUILD = '4.9.2 · 2026-10-08'; window.MesimaNative;</script></html>"+padding
  assertEquals(app,Updater.validateContent(app.toByteArray()))
  assertEquals("4.9.2",Updater.semanticVersion("4.9.2 · 2026-10-08"))
 }
}
