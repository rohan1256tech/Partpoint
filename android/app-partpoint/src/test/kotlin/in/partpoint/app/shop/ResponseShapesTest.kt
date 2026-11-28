package `in`.partpoint.app.shop

import `in`.partpoint.core.network.apiJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Replies copied from the real API, so a model that does not match fails here and not on a phone. */
class ResponseShapesTest {
    @Test fun `order placed reply`() {
        val json = """{"checkoutId":"c1","subtotalPaise":91500,"discountPaise":9150,"deliveryFeePaise":0,"totalPaise":82350,
            "orders":[{"id":"o1","orderNumber":"PP-20261127-000012","totalPaise":82350}]}"""
        val placed = apiJson.decodeFromString(PlacedOrders.serializer(), json)
        assertEquals("PP-20261127-000012", placed.orders.single().orderNumber)
    }

    @Test fun `retailer order is bought from Partpoint, possibly in parcels`() {
        val json = """{"id":"o1","orderNumber":"PP-20261127-000012","status":"forwarded","totalPaise":54500,"itemCount":1,"wholesaler":null,
            "retailer":{"id":"r1","shopName":"Patil Mobile Care"},"createdAt":"2026-11-27T00:13:00Z","subtotalPaise":54500,"discountPaise":0,
            "deliveryFeePaise":0,"commissionPaise":null,"supplyTotalPaise":null,
            "address":{"contactName":"Anil","contactPhone":"+919000000202","line1":"Main Road","line2":null,"landmark":null,"city":"Pune","state":"Maharashtra","pincode":"411014"},
            "items":[{"id":"i1","productId":"p1","variantId":"v1","productName":"Battery for Pulse Note 12","variantName":"5000 mAh","hsnCode":"85076000",
              "gstRateBps":1800,"qty":5,"unitPricePaise":10900,"lineTotalPaise":54500,"supplyUnitPricePaise":null}],
            "timeline":[{"status":"placed","note":null,"at":"2026-11-27T00:13:00Z"}],
            "siblings":[{"id":"o2","orderNumber":"PP-20261127-000012-2","status":"accepted"}],
            "cancelReason":null,"deliveredAt":null,"deliveryPartner":null,"deliveryAccepted":false,"deliveryOtpAttempts":null,"deliveryOtp":null,"pickup":null}"""
        val o = apiJson.decodeFromString(OrderDetail.serializer(), json)
        assertNull(o.wholesaler)
        assertEquals("PP-20261127-000012-2", o.siblings.single().orderNumber)
    }

    @Test fun `wholesaler order shows the area only and supply prices`() {
        val json = """{"id":"o1","orderNumber":"PP-1","status":"forwarded","totalPaise":54500,"subtotalPaise":54500,"itemCount":1,
            "wholesaler":{"id":"w1","businessName":"Lamington Mobile Hub"},"retailer":{"id":"r1","shopName":"Patil Mobile Care"},
            "supplyTotalPaise":50000,"siblings":[],
            "address":{"city":"Pune","state":"Maharashtra","pincode":"411014"},
            "items":[{"id":"i1","productId":"p1","variantId":"v1","productName":"Battery","variantName":"5000 mAh","qty":5,"unitPricePaise":10900,
              "lineTotalPaise":54500,"supplyUnitPricePaise":10000}],
            "timeline":[],"createdAt":"2026-11-27T00:13:00Z"}"""
        val o = apiJson.decodeFromString(OrderDetail.serializer(), json)
        assertEquals("Pune", o.address.city)
        assertNull(o.address.line1)
        assertEquals(50000L, o.supplyTotalPaise)
        assertEquals(10000L, o.items.single().supplyUnitPricePaise)
    }

    @Test fun `cart is one list`() {
        val json = """{"lines":[{"variantId":"v1","productId":"p1","productName":"20W USB-C fast charger","variantName":"White","thumbnailUrl":null,
            "qty":10,"unitPricePaise":39900,"mrpPaise":99900,"lineTotalPaise":399000,"minOrderQty":1,"stockQty":440,"issue":null}],
            "itemCount":1,"subtotalPaise":399000,"discountPaise":0,"deliveryFeePaise":4000,"totalPaise":403000,"coupon":null,"couponError":null,
            "minOrderPaise":30000,"belowMinOrder":false,"canCheckout":true}"""
        val cart = apiJson.decodeFromString(Cart.serializer(), json)
        assertEquals(1, cart.lines.size)
        assertEquals(403000L, cart.totalPaise)
    }

    @Test fun `wholesaler catalog product carries their own offer`() {
        val json = """{"id":"p1","name":"Battery for Pulse Note 12","description":null,"partNumber":"NC-BAT-N12","hsnCode":"85076000","gstRateBps":1800,
            "status":"active","statusReason":null,"ratingAvg":0,"ratingCount":0,"category":{"id":"c1","name":"Batteries"},"brand":{"id":"b1","name":"NexCell"},
            "images":[],"variants":[{"id":"v1","name":"5000 mAh","sku":null,"mrpPaise":125000,"pricePaise":72000,"stockQty":180,"minOrderQty":1,
              "isActive":true,"slabs":[],"offers":null,"myOffer":{"supplyPricePaise":66000,"stockQty":80,"isActive":true}}],
            "createdAt":"2026-11-27T00:13:00Z","updatedAt":"2026-11-27T00:13:00Z"}"""
        val p = apiJson.decodeFromString(ProductDetail.serializer(), json)
        assertEquals(80, p.variants.single().myOffer?.stockQty)
    }
}
