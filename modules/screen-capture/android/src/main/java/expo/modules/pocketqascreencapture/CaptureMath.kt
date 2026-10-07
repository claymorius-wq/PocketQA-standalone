package expo.modules.pocketqascreencapture

/** Pure capture-size rule (unit-tested): keep the aspect, cap the long edge, use even dimensions. */
object CaptureMath {
  fun size(width: Int, height: Int, maxEdge: Int): Pair<Int, Int> {
    val scale = minOf(1.0, maxEdge.toDouble() / maxOf(width, height))
    val w = ((width * scale).toInt() / 2) * 2
    val h = ((height * scale).toInt() / 2) * 2
    return maxOf(w, 2) to maxOf(h, 2)
  }
}
