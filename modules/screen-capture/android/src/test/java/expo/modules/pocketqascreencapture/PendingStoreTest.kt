package expo.modules.pocketqascreencapture

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// The on-disk handoff between the recording service and the session screen
// (docs/plans/native-screen-voice-recording.md, Android design 5).
class PendingStoreTest {
  private lateinit var dir: File
  private var clock = 1_000_000L
  private lateinit var store: PendingStore

  @Before fun setUp() {
    dir = Files.createTempDirectory("pqa-recordings").toFile()
    clock = 1_000_000L
    store = PendingStore(dir) { clock }
  }

  private fun recorded(bytes: Int = 10): File = store.newFile().apply { writeBytes(ByteArray(bytes)) }

  @Test fun aFinishedClipIsHandedToItsSessionOnceAndThenOwnedByJs() {
    val f = recorded()
    store.markComplete(f, durationMs = 7000, tag = "p1", reason = "system")
    val taken = store.take("p1")
    assertEquals(1, taken.size)
    assertEquals(f, taken[0].file)
    assertEquals(7000L, taken[0].durationMs)
    assertEquals("system", taken[0].reason)
    // Claimed: never handed out again, and the file itself stays for JS to review or delete.
    assertTrue(store.take("p1").isEmpty())
    assertTrue(f.exists())
  }

  @Test fun anotherSessionNeverSeesTheClip() {
    store.markComplete(recorded(), 1000, "p1", "user")
    assertTrue(store.take("p2").isEmpty())
    assertEquals(1, store.take("p1").size)
  }

  @Test fun aTruncatedFileFromProcessDeathIsSweptButTheActiveOneIsKept() {
    val truncated = recorded()
    val active = recorded()
    val done = recorded()
    store.markComplete(done, 1000, "p1", "user")
    store.sweep(active = active)
    assertFalse(truncated.exists())
    assertTrue(active.exists())
    assertTrue(done.exists())
    assertEquals(1, store.take("p1").size)
  }

  @Test fun anEmptyRecordingIsNeverOffered() {
    val empty = recorded(bytes = 0)
    assertFalse(store.markComplete(empty, 0, "p1", "user"))
    assertTrue(store.take("p1").isEmpty())
    assertFalse(empty.exists())
  }

  @Test fun unclaimedClipsExpireAfterADay() {
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user")
    clock += PendingStore.TTL_MS + 1
    store.sweep(active = null)
    assertFalse(f.exists())
    assertTrue(store.take("p1").isEmpty())
  }

  @Test fun aClaimedFileJsLostTrackOfIsSweptLater() {
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user")
    store.take("p1")
    store.sweep(active = null)
    assertFalse(f.exists())
  }

  @Test fun aMetadataFileWithoutItsVideoIsDropped() {
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user")
    f.delete()
    assertTrue(store.take("p1").isEmpty())
    store.sweep(active = null)
    assertTrue(dir.listFiles()!!.isEmpty())
  }
}
