using System;
using System.Windows;
using System.Windows.Controls;
using ActivityAgent.Service.Configuration;

namespace ActivityAgent.Service;

public partial class SettingsWindow : Window
{
    private bool _isCustomMode = false;
    public bool SettingsChanged { get; private set; }
    public AgentConfig? NewConfig { get; private set; }

    public SettingsWindow()
    {
        InitializeComponent();
        LoadCurrentSettings();
    }

    private void LoadCurrentSettings()
    {
        var config = AgentConfig.LoadFromRegistry();
        
        ApiUrlBox.Text = config.ApiUrl;
        ApiKeyBox.Password = config.ApiKey;
        
        // Detect environment
        if (config.ApiUrl.Contains("localhost") || config.ApiUrl.Contains("127.0.0.1"))
        {
            EnvironmentCombo.SelectedIndex = 1; // Local
        }
        else if (config.ApiUrl.Contains("app.saswatch.com") || config.ApiUrl.Contains("railway"))
        {
            EnvironmentCombo.SelectedIndex = 0; // Production
        }
        else
        {
            EnvironmentCombo.SelectedIndex = 2; // Custom
            _isCustomMode = true;
        }
    }

    private void EnvironmentCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (EnvironmentCombo.SelectedItem is ComboBoxItem item)
        {
            _isCustomMode = item.Tag?.ToString() == "custom";
            
            if (!_isCustomMode)
            {
                if (item.Tag?.ToString() == "local")
                {
                    ApiUrlBox.Text = "http://localhost:3000/api/track";
                }
                else if (item.Tag?.ToString() == "prod")
                {
                    ApiUrlBox.Text = "https://app.saswatch.com/api/track";
                }
            }
        }
    }

    private void ApiUrlBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_isCustomMode)
        {
            EnvironmentCombo.SelectedIndex = 2; // Switch to Custom
        }
    }

    private void ApiKeyBox_PasswordChanged(object sender, RoutedEventArgs e)
    {
        // Keep in custom mode when API key changes
        if (!_isCustomMode)
        {
            _isCustomMode = true;
            EnvironmentCombo.SelectedIndex = 2;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        // Validate
        if (string.IsNullOrWhiteSpace(ApiUrlBox.Text))
        {
            MessageBox.Show("API URL is required.", "Validation Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (string.IsNullOrWhiteSpace(ApiKeyBox.Password))
        {
            MessageBox.Show("API Key is required.", "Validation Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // Create config
        var config = new AgentConfig
        {
            ApiUrl = ApiUrlBox.Text.Trim(),
            ApiKey = ApiKeyBox.Password
        };

        // Try to save to registry
        try
        {
            var saved = AgentConfig.SaveToRegistry(config);
            if (!saved)
            {
                var result = MessageBox.Show(
                    "Failed to save settings. This may require Administrator privileges.\n\n" +
                    "Would you like to try running as Administrator?",
                    "Save Failed",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Warning);

                if (result == MessageBoxResult.Yes)
                {
                    MessageBox.Show(
                        "Please restart the application as Administrator to save settings.",
                        "Administrator Required",
                        MessageBoxButton.OK,
                        MessageBoxImage.Information);
                }
                return;
            }

            NewConfig = config;
            SettingsChanged = true;
            
            MessageBox.Show(
                "Settings saved successfully!\n\nThe agent will restart to apply changes.",
                "Settings Saved",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            
            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Error saving settings: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}

