package com.saro.cyberdeck;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Handles login to a CyberDeck node and opens its web interface in a fullscreen WebView.
 */
public class ConnectActivity extends AppCompatActivity {

    private WebView webView;
    private View loginContainer;
    private View webViewContainer;
    private EditText usernameInput;
    private EditText passwordInput;
    private Button loginButton;
    private TextView nodeTitle;
    private TextView errorText;
    private ProgressBar progressBar;
    private ProgressBar webProgress;

    private String nodeIp;
    private int nodePort;
    private String nodeName;
    private String authToken;

    private final OkHttpClient httpClient = new OkHttpClient.Builder()
            .hostnameVerifier((hostname, session) -> true)
            .build();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_connect);

        nodeIp = getIntent().getStringExtra("ip");
        nodePort = getIntent().getIntExtra("port", 8888);
        nodeName = getIntent().getStringExtra("name");

        if (nodeIp == null) {
            finish();
            return;
        }

        // Setup views
        webViewContainer = findViewById(R.id.webViewContainer);
        nodeTitle = findViewById(R.id.nodeTitle);
        webProgress = findViewById(R.id.webProgress);
        webView = findViewById(R.id.webView);

        setupWebView();

        // Load the CyberDeck web interface directly
        String url = "http://" + nodeIp + ":" + nodePort;
        webView.loadUrl(url);
    }

    private void attemptLogin() {
        // Redundant - server handles login
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        settings.setBuiltInZoomControls(false);
        settings.setSupportZoom(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " CyberDeckApp/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                webProgress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                webProgress.setVisibility(View.GONE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false; // Stay in WebView
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.proceed(); // Accept self-signed from CyberDeck nodes
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                webProgress.setProgress(newProgress);
            }
        });
    }

    private void openWebView() {
        // Now called directly in onCreate
    }

    @Override
    public void onBackPressed() {
        if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
        } else if (webViewContainer.getVisibility() == View.VISIBLE) {
            // Go back to login screen
            webViewContainer.setVisibility(View.GONE);
            loginContainer.setVisibility(View.VISIBLE);
            webView.loadUrl("about:blank");
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
