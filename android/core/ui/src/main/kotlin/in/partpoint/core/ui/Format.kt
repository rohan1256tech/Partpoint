package `in`.partpoint.core.ui

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val IST: ZoneId = ZoneId.of("Asia/Kolkata")
private val DATE_TIME = DateTimeFormatter.ofPattern("d MMM yyyy, h:mm a", Locale.ENGLISH)
private val DATE = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)

/** Indian digit grouping: 1234567 → "12,34,567". */
private fun groupIndian(n: Long): String {
    val s = n.toString()
    if (s.length <= 3) return s
    val last3 = s.takeLast(3)
    val rest = s.dropLast(3).reversed().chunked(2).joinToString(",").reversed()
    return "$rest,$last3"
}

/** Paise → "₹1,23,456.50"; whole rupees drop the ".00" unless [alwaysDecimals]. */
fun rupees(paise: Long, alwaysDecimals: Boolean = false): String {
    val sign = if (paise < 0) "−" else ""
    val abs = kotlin.math.abs(paise)
    val r = abs / 100
    val p = abs % 100
    val decimals = if (p != 0L || alwaysDecimals) ".%02d".format(p) else ""
    return "$sign₹${groupIndian(r)}$decimals"
}

/** "26 Nov 2026, 7:06 PM" in India time. */
fun dateTime(iso: String): String = runCatching { DATE_TIME.format(Instant.parse(iso).atZone(IST)) }.getOrDefault(iso)

fun date(iso: String): String = runCatching { DATE.format(Instant.parse(iso).atZone(IST)) }.getOrDefault(iso)

/** "out_for_delivery" → "Out for delivery". */
fun humanize(code: String): String = code.replace('_', ' ').replaceFirstChar { it.uppercase() }

/** Percentage saved against MRP, or null when there is no saving. */
fun discountPercent(mrpPaise: Long?, pricePaise: Long?): Int? {
    if (mrpPaise == null || pricePaise == null || mrpPaise <= 0 || pricePaise >= mrpPaise) return null
    return (((mrpPaise - pricePaise) * 100) / mrpPaise).toInt().takeIf { it >= 1 }
}
