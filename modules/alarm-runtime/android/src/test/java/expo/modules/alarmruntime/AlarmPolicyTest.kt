package expo.modules.alarmruntime

import org.junit.Assert.*
import org.junit.Test

class AlarmPolicyTest {
  @Test fun automaticTaskRemindersKeepTenMinuteCadenceAfterTimeoutOrReplacement() {
    assertEquals(601_000L, AlarmPolicy.nextTaskReminderAt(1_000L, 61_000L))
    assertEquals(601_000L, AlarmPolicy.nextTaskReminderAt(1_000L, 121_000L))
    assertEquals(702_000L, AlarmPolicy.nextTaskReminderAt(1_000L, 701_000L))
    assertTrue(AlarmPolicy.TASK_RING_DURATION_MS < AlarmPolicy.TASK_REPEAT_MINUTES * 60_000L)
  }
  @Test fun taskRepeatsOnlyWhileRingingAndNeverAfterWithdrawal() {
    assertEquals(10, AlarmPolicy.TASK_REPEAT_MINUTES)
    assertTrue(AlarmPolicy.shouldRepeatTask("task-1", "ALARM", "FIRED", false))
    assertFalse(AlarmPolicy.shouldRepeatTask(null, "ALARM", "FIRED", false))
    assertFalse(AlarmPolicy.shouldRepeatTask("task-1", "NOTIFICATION", "FIRED", false))
    assertFalse(AlarmPolicy.shouldRepeatTask("task-1", "ALARM", "FIRED", true))
    for (status in listOf("CANCELLED", "SCHEDULED", "EXPIRED", "FAILED"))
      assertFalse(AlarmPolicy.shouldRepeatTask("task-1", "ALARM", status, false))
  }

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
