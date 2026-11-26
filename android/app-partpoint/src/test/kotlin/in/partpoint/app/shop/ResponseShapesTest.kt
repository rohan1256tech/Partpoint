package `in`.partpoint.app.shop

import `in`.partpoint.core.network.apiJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Replies copied from the real API, so a model that does not match fails here and not on a phone. */
class ResponseShapesTest {
    @Test fun `order placed reply`() {
        val json = """{"checkoutId":"c1","subtotalPaise":91500,"discountPaise":9150,"deliveryFeePaise":0,"totalPaise":82350,
            "orders":[{"id":"o1","orderNumber":"PP-20261127-000012","wholesalerId":"w1","totalPaise":82350}]}"""
        val placed = apiJson.decodeFromString(PlacedOrders.serializer(), json)
        assertEquals("PP-20261127-000012", placed.orders.single().orderNumber)
        assertEquals("w1", placed.orders.single().wholesalerId)
    }

    @Test fun `seller sees only the delivery area`() {
        val json = """{"id":"o1","orderNumber":"PP-1","status":"placed","totalPaise":54500,"subtotalPaise":54500,"itemCount":1,
            "wholesaler":{"id":"w1","businessName":"Deccan Parts House"},"retailer":{"id":"r1","shopName":"Patil Motor Garage"},
            "address":{"city":"Pune","state":"Maharashtra","pincode":"411014"},"items":[],"timeline":[],"createdAt":"2026-11-27T00:13:00Z"}"""
        val o = apiJson.decodeFromString(OrderDetail.serializer(), json)
        assertEquals("Pune", o.address.city)
        assertNull(o.address.line1)
    }
}
