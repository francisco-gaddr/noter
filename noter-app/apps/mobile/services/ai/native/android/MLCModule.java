package com.noter;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

// Placeholder for MLC Engine import
// import ai.mlc.mlcllm.MLCEngine; 

public class MLCModule extends ReactContextBaseJavaModule {
    // private MLCEngine engine;

    MLCModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "MLCModule";
    }

    @ReactMethod
    public void loadModel(String path) {
        // TODO: Initialize MLC Engine with path
        // engine = new MLCEngine(path);
        System.out.println("Loading model from: " + path);
    }

    @ReactMethod
    public void generate(String prompt, Promise promise) {
        // No real MLC engine is linked in this build. Reject honestly instead of
        // resolving a canned string that the chat UI would render as a "model reply".
        // When the MLC AAR is added: String output = engine.generate(prompt);
        // promise.resolve(output);
        promise.reject(
            "engine_unavailable",
            "On-device MLC engine is not linked in this build. Add the MLC AAR dependency, or use a Hermes (self-hosted Ollama/LM Studio) source."
        );
    }
}
