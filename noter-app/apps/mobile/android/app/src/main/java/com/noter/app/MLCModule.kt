package com.noter.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.lang.reflect.Method
import java.lang.reflect.Modifier

class MLCModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private var engine: Any? = null
    private var generateMethod: Method? = null

    private val engineCandidates = listOf(
        "ai.mlc.mlcllm.MLCEngine",
        "ai.mlc.mlcllm.ChatModule"
    )

    private val converterCandidates = listOf(
        "ai.mlc.mlcllm.MLCConverter",
        "ai.mlc.mlcllm.ModelConverter",
        "ai.mlc.mlcllm.converter.MLCConverter",
        "ai.mlc.mlcllm.converter.ModelConverter"
    )

    override fun getName(): String {
        return "MLCModule"
    }

    private fun findMethod(clazz: Class<*>, vararg names: String): Method? {
        return clazz.methods.firstOrNull { method -> names.any { it == method.name } }
    }

    private fun loadFirstClass(candidates: List<String>): Class<*> {
        var lastError: Throwable? = null
        for (candidate in candidates) {
            try {
                return Class.forName(candidate)
            } catch (e: Throwable) {
                lastError = e
            }
        }
        throw ClassNotFoundException(lastError?.message ?: "No matching class found")
    }

    private fun resolveConverterMethod(converterClass: Class<*>): Method? {
        val method = findMethod(converterClass, "convertGGUFToMLC", "convert", "convertModel") ?: return null
        val argCount = method.parameterTypes.size
        if (argCount < 3 || argCount > 4) return null
        return method
    }

    private fun invokeConverter(method: Method, target: Any?, inputPath: String, outputPath: String, quantization: String, platform: String) {
        when (method.parameterTypes.size) {
            3 -> method.invoke(target, inputPath, outputPath, quantization)
            4 -> method.invoke(target, inputPath, outputPath, quantization, platform)
            else -> throw IllegalStateException("Unsupported converter method signature")
        }
    }

    @ReactMethod
    fun loadModel(path: String) {
        val engineClass = loadFirstClass(engineCandidates)
        val created = engineClass.constructors.firstNotNullOfOrNull { constructor ->
            val params = constructor.parameterTypes
            try {
                when {
                    params.size == 1 && params[0] == String::class.java -> constructor.newInstance(path)
                    params.size == 1 && ReactApplicationContext::class.java.isAssignableFrom(params[0]) -> constructor.newInstance(reactContext)
                    params.isEmpty() -> constructor.newInstance()
                    else -> null
                }
            } catch (_: Throwable) {
                null
            }
        } ?: throw IllegalStateException("No compatible MLCEngine constructor found")

        val reload = findMethod(created.javaClass, "reload", "loadModel", "load")
        if (reload != null) {
            when (reload.parameterTypes.size) {
                1 -> reload.invoke(created, path)
                2 -> reload.invoke(created, path, "model_lib")
            }
        }

        val generator = findMethod(created.javaClass, "generate", "chat", "complete", "inference")
            ?: throw IllegalStateException("No generation method found in MLCEngine")
        engine = created
        generateMethod = generator
    }

    @ReactMethod
    fun generate(prompt: String, promise: Promise) {
        val currentEngine = engine
        val currentMethod = generateMethod
        if (currentEngine == null || currentMethod == null) {
            promise.reject("no_engine", "Model not loaded")
            return
        }
        try {
            val output = when (currentMethod.parameterTypes.size) {
                1 -> currentMethod.invoke(currentEngine, prompt)
                2 -> currentMethod.invoke(currentEngine, prompt, false)
                else -> throw IllegalStateException("Unsupported generate method signature")
            }
            promise.resolve(output?.toString() ?: "")
        } catch (e: Throwable) {
            promise.reject("generate_failed", e.message, e)
        }
    }

    @ReactMethod
    fun unloadModel() {
        engine = null
        generateMethod = null
    }

    @ReactMethod
    fun getLocalConversionCapabilities(promise: Promise) {
        val map = Arguments.createMap()
        try {
            val engineClass = loadFirstClass(engineCandidates)
            map.putBoolean("engineAvailable", true)
            map.putString("engineClass", engineClass.name)
        } catch (e: Throwable) {
            map.putBoolean("engineAvailable", false)
            map.putString("engineError", e.message)
        }
        try {
            val converterClass = loadFirstClass(converterCandidates)
            val converterMethod = resolveConverterMethod(converterClass)
            map.putBoolean("converterAvailable", converterMethod != null)
            map.putString("converterClass", converterClass.name)
            if (converterMethod != null) {
                map.putString("converterMethod", converterMethod.name)
            }
        } catch (e: Throwable) {
            map.putBoolean("converterAvailable", false)
            map.putString("converterError", e.message)
        }
        promise.resolve(map)
    }

    @ReactMethod
    fun convertGGUFToMLC(inputPath: String, outputPath: String, quantization: String, platform: String, promise: Promise) {
        try {
            val converterClass = loadFirstClass(converterCandidates)
            val converterMethod = resolveConverterMethod(converterClass)
                ?: throw IllegalStateException("No compatible converter method found in MLC SDK")
            val target = if (Modifier.isStatic(converterMethod.modifiers)) null else converterClass.getDeclaredConstructor().newInstance()
            invokeConverter(converterMethod, target, inputPath, outputPath, quantization, platform)
            promise.resolve(outputPath)
        } catch (e: Throwable) {
            promise.reject("local_conversion_failed", e.message, e)
        }
    }

    @ReactMethod
    fun runLocalConversionSelfTest(inputPath: String, outputPath: String, quantization: String, promise: Promise) {
        try {
            val converterClass = loadFirstClass(converterCandidates)
            val converterMethod = resolveConverterMethod(converterClass)
                ?: throw IllegalStateException("No compatible converter method found in MLC SDK")
            val target = if (Modifier.isStatic(converterMethod.modifiers)) null else converterClass.getDeclaredConstructor().newInstance()
            invokeConverter(converterMethod, target, inputPath, outputPath, quantization, "android")
            val map = Arguments.createMap()
            map.putBoolean("ok", true)
            map.putString("outputPath", outputPath)
            map.putBoolean("configExists", File(outputPath, "mlc-chat-config.json").exists())
            map.putString("converterClass", converterClass.name)
            map.putString("converterMethod", converterMethod.name)
            promise.resolve(map)
        } catch (e: Throwable) {
            promise.reject("self_test_failed", e.message, e)
        }
    }
}
