package expo.modules.pocketqascreencapture

import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureMathTest {
  @Test fun capsTheLongEdgeKeepsTheAspectAndUsesEvenSizes() {
    assertEquals(576 to 1280, CaptureMath.size(1080, 2400, 1280))
    assertEquals(1280 to 576, CaptureMath.size(2400, 1080, 1280))
  }
  @Test fun neverUpscalesAndRoundsOddSizesDown() {
    assertEquals(720 to 1280, CaptureMath.size(720, 1280, 1280))
    assertEquals(640 to 480, CaptureMath.size(641, 481, 1280))
  }
}
