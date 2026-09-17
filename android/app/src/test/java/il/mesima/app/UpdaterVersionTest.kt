package il.mesima.app
import org.junit.Test
import org.junit.Assert.*
class UpdaterVersionTest {
 @Test fun newerBundleCannotBeReplacedByOldServerContent(){
  assertTrue(Updater.contentVersion("const BUILD = '4.7 · 2026-09-15';")>Updater.contentVersion("const BUILD = '4.6 · 2026-09-06';"))
  assertTrue(Updater.contentVersion("const BUILD = '4.10';")>Updater.contentVersion("const BUILD = '4.9';"))
  assertTrue(Updater.contentVersion("const BUILD = '4.7.1';")>Updater.contentVersion("const BUILD = '4.7';"))
  assertTrue(Updater.contentVersion("const BUILD = '4.8';")>Updater.contentVersion("const BUILD = '4.7.12';"))
  assertEquals(0L,Updater.contentVersion("<html>error</html>"))
 }
}
