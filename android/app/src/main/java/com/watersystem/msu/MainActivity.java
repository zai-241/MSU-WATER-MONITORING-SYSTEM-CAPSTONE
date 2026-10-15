package com.watersystem.msu;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        final long startTime = System.currentTimeMillis();
        // Keep the splash screen visible for 2 seconds
        splashScreen.setKeepOnScreenCondition(() -> System.currentTimeMillis() - startTime < 2000);

        // Set up fade-out and scale-down animation for the splash screen
        splashScreen.setOnExitAnimationListener(splashScreenViewProvider -> {
            final android.view.View splashScreenView = splashScreenViewProvider.getView();
            final android.view.View iconView = splashScreenViewProvider.getIconView();

            // Create fade-out animation
            android.view.ViewPropertyAnimator fadeOut = splashScreenView.animate()
                    .alpha(0f)
                    .setDuration(500L)
                    .setInterpolator(new android.view.animation.AccelerateInterpolator())
                    .withEndAction(splashScreenViewProvider::remove);

            // Create scale-down animation for the icon
            iconView.animate()
                    .scaleX(0f)
                    .scaleY(0f)
                    .setDuration(500L)
                    .setInterpolator(new android.view.animation.AccelerateInterpolator())
                    .start();

            fadeOut.start();
        });
    }
}
