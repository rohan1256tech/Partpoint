# kotlinx.serialization: keep generated serializers for API models.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class in.partpoint.**$$serializer { *; }

# Retrofit interfaces are used reflectively.
-keep,allowobfuscation interface in.partpoint.**.*Api
-keepattributes Signature, Exceptions

# No debug logging in release builds (README security).
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
