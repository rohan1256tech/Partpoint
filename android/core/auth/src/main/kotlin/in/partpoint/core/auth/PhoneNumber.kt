package `in`.partpoint.core.auth

/**
 * Indian mobile numbers, the same rules as the API (backend auth.schemas.ts):
 * "9876543210", "09876543210", "919876543210" and "+91 98765-43210" all become "+919876543210".
 */
object PhoneNumber {
    private val TEN = Regex("^[6-9]\\d{9}$")

    /** E.164 (+91…) or null when it is not a valid Indian mobile number. */
    fun normalize(input: String): String? {
        val digits = input.replace(Regex("[\\s-]"), "")
        val ten = when {
            digits.startsWith("+91") -> digits.removePrefix("+91")
            digits.length == 12 && digits.startsWith("91") -> digits.removePrefix("91")
            digits.length == 11 && digits.startsWith("0") -> digits.removePrefix("0")
            else -> digits
        }
        return if (TEN.matches(ten)) "+91$ten" else null
    }

    /** "+919876543210" → "98765 43210", for display. */
    fun display(e164: String): String {
        val ten = e164.removePrefix("+91")
        return if (ten.length == 10) "${ten.take(5)} ${ten.drop(5)}" else e164
    }
}
