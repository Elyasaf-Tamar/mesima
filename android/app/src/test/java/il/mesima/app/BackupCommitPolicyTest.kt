package il.mesima.app

import org.junit.Assert.*
import org.junit.Test
import il.mesima.app.BackupCommitPolicy.Decision
import il.mesima.app.BackupCommitPolicy.Observation

class BackupCommitPolicyTest {
    private val path = "users/test-user/backups/new-id.json"
    private val hash = "a".repeat(64)

    @Test fun matchingServerMetadataRecoversALostCommitResponse() {
        val observed = BackupCommitPolicy.observe(true, true, path, hash, path, hash)
        assertEquals(Observation.MATCHING, observed)
        assertEquals(Decision.COMMITTED, BackupCommitPolicy.decide("DEADLINE_EXCEEDED", observed))
        assertEquals(Decision.COMMITTED, BackupCommitPolicy.decide("PERMISSION_DENIED", observed))
    }

    @Test fun onlyDefiniteRejectedWritesPermitCleanupAfterConfirmedAbsence() {
        val absent = BackupCommitPolicy.observe(false, true, null, null, path, hash)
        for (code in listOf("PERMISSION_DENIED", "INVALID_ARGUMENT")) {
            assertEquals(Decision.CLEAN_UNCOMMITTED, BackupCommitPolicy.decide(code, absent))
            assertEquals(Decision.KEEP_UPLOAD, BackupCommitPolicy.decide(code, Observation.UNKNOWN))
            assertEquals(Decision.KEEP_UPLOAD, BackupCommitPolicy.decide(code, Observation.MISMATCHED))
        }
    }

    @Test fun anImmediateAbsentReadCannotAuthorizeDeletionOfAPossibleLateCommit() {
        for (code in listOf(null, "UNKNOWN", "CANCELLED", "DEADLINE_EXCEEDED", "UNAVAILABLE", "INTERNAL",
                            "ABORTED", "DATA_LOSS", "RESOURCE_EXHAUSTED", "UNAUTHENTICATED")) {
            assertEquals("must retain upload for $code", Decision.KEEP_UPLOAD,
                BackupCommitPolicy.decide(code, Observation.ABSENT))
            // The same write may become visible after the earlier absent read.
            assertEquals(Decision.COMMITTED, BackupCommitPolicy.decide(code, Observation.MATCHING))
        }
    }

    @Test fun mismatchedOrMalformedMetadataNeverAuthorizesDeletingTheObject() {
        for ((actualPath, actualHash) in listOf(path to "b".repeat(64), "users/other/backups/x.json" to hash,
                                               null to hash, path to 42)) {
            val observed = BackupCommitPolicy.observe(true, true, actualPath, actualHash, path, hash)
            assertEquals(Observation.MISMATCHED, observed)
            assertEquals(Decision.KEEP_UPLOAD, BackupCommitPolicy.decide("PERMISSION_DENIED", observed))
        }
    }

    @Test fun cachedOrPendingLocalMetadataIsNotServerConfirmation() {
        for (exists in listOf(true, false)) {
            val observed = BackupCommitPolicy.observe(exists, false, path, hash, path, hash)
            assertEquals(Observation.UNKNOWN, observed)
            assertEquals(Decision.KEEP_UPLOAD, BackupCommitPolicy.decide("INVALID_ARGUMENT", observed))
        }
    }
}
