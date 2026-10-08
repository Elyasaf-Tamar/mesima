package il.mesima.app

/** A failed response does not prove that the metadata write failed to commit.
 * In particular, a server read can report absence before a timed-out write
 * commits later. Only a definite rejection plus confirmed absence allows cleanup. */
object BackupCommitPolicy {
    enum class Observation { UNKNOWN, ABSENT, MATCHING, MISMATCHED }
    enum class Decision { COMMITTED, CLEAN_UNCOMMITTED, KEEP_UPLOAD }

    fun observe(exists: Boolean, serverConfirmed: Boolean, path: Any?, hash: Any?,
                expectedPath: String, expectedHash: String): Observation {
        if (!serverConfirmed) return Observation.UNKNOWN
        if (!exists) return Observation.ABSENT
        return if (path == expectedPath && hash == expectedHash) Observation.MATCHING else Observation.MISMATCHED
    }

    fun decide(failureCode: String?, observation: Observation): Decision {
        if (observation == Observation.MATCHING) return Decision.COMMITTED
        // Keep this allowlist narrow. Network, deadline, cancellation and server
        // failures must retain the object even after an immediate absent read.
        val rejected = failureCode in setOf("PERMISSION_DENIED", "INVALID_ARGUMENT")
        return if (rejected && observation == Observation.ABSENT) Decision.CLEAN_UNCOMMITTED else Decision.KEEP_UPLOAD
    }
}
