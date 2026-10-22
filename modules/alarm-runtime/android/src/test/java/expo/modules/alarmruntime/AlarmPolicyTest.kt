package expo.modules.alarmruntime

import org.junit.Assert.*
import org.junit.Test

class AlarmPolicyTest {
  @Test fun onlyNewConfirmedDecisionCrossesCancellation() {
    assertFalse(AlarmPolicy.mayCrossCancellation(2, 3, 2, 3))
    assertFalse(AlarmPolicy.mayCrossCancellation(3, 3, 2, 3))
    assertFalse(AlarmPolicy.mayCrossCancellation(1, 4, 2, 3))
    assertTrue(AlarmPolicy.mayCrossCancellation(2, 4, 2, 3))
  }
  @Test fun eachVersionAxisIsMonotonic() {
    assertTrue(AlarmPolicy.stale(1, 3, 4, 2, 3, 4))
    assertTrue(AlarmPolicy.stale(2, 2, 4, 2, 3, 4))
    assertTrue(AlarmPolicy.stale(2, 3, 3, 2, 3, 4))
    assertFalse(AlarmPolicy.stale(2, 3, 4, 2, 3, 4))
  }
  @Test fun receiverRejectsOldDuplicateAndTerminalDeliveries() {
    assertFalse(AlarmPolicy.mayFire("FIRED", false, 100, 101))
    assertFalse(AlarmPolicy.mayFire("CANCELLED", false, 100, 101))
    assertFalse(AlarmPolicy.mayFire("FAILED", false, 100, 101))
    assertFalse(AlarmPolicy.mayFire("SCHEDULED", true, 100, 101))
    assertFalse(AlarmPolicy.mayFire("SCHEDULED", false, 100, 60_101))
    assertFalse(AlarmPolicy.mayFire("SCHEDULED", false, 100, 99))
    assertTrue(AlarmPolicy.mayFire("SCHEDULING", false, 100, 101))
  }
}
