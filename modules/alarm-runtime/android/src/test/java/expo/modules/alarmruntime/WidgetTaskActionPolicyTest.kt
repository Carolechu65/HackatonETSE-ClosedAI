package expo.modules.alarmruntime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetTaskActionPolicyTest {
  private fun action(user: String? = "user_1", group: String? = "group-1", task: String? = "task_1",
    version: Long = 2, status: String? = "completed") =
    WidgetTaskAction.validated("operation-1", user, group, task, version, status, 1000)

  @Test fun validatesOnlyExplicitCompletionOrReopening() {
    assertNotNull(action())
    assertEquals("pending", action(status = "pending")!!.status)
    for (status in listOf(null, "accepted", "cancelled", "COMPLETED", "completed?accept=1")) assertNull(action(status = status))
  }

  @Test fun rejectsInvalidScopeAndUnsafeVersions() {
    for (invalid in listOf(null, "", "../task", "task/id", "task%2Fid", "a".repeat(129))) {
      assertNull(action(user = invalid))
      assertNull(action(group = invalid))
      assertNull(action(task = invalid))
    }
    for (invalid in listOf(-1L, 0L, 9007199254740992L, Long.MAX_VALUE)) assertNull(action(version = invalid))
    assertNotNull(action(version = 9007199254740991L))
  }

  @Test fun deduplicatesTheSamePendingIntentButKeepsDistinctVersionsAndAccounts() {
    val first = action()!!
    assertTrue(first.sameIntent(first.copy(id = "operation-2", createdAtEpochMs = 2000)))
    assertFalse(first.sameIntent(first.copy(userId = "user_2")))
    assertFalse(first.sameIntent(first.copy(groupId = "group_2")))
    assertFalse(first.sameIntent(first.copy(taskId = "task_2")))
    assertFalse(first.sameIntent(first.copy(expectedVersion = 3)))
    assertFalse(first.sameIntent(first.copy(status = "pending")))
  }
}
