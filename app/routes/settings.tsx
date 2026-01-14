import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ChevronLeft } from 'lucide-react';
import { authFetch } from '../utils/auth';

export const Route = createFileRoute('/settings')({
  component: () => (
    <ProtectedRoute>
      <SettingsPage />
    </ProtectedRoute>
  ),
});

interface EmailSettings {
  imap_enabled: boolean;
  imap_server: string | null;
  imap_port: number | null;
  imap_username: string | null;
  imap_folder: string | null;
}

function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [formData, setFormData] = useState({
    server: '',
    port: 993,
    username: '',
    password: '',
    folder: 'INBOX',
  });
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const response = await authFetch('/api/email-settings');

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        setFormData({
          server: data.imap_server || '',
          port: data.imap_port || 993,
          username: data.imap_username || '',
          password: '',
          folder: data.imap_folder || 'INBOX',
        });
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  }

  async function testConnection() {
    setTestStatus('testing');
    setTestMessage('');

    try {
      const response = await authFetch('/api/email-settings/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        setTestStatus('success');
        setTestMessage('Connection successful!');
      } else {
        setTestStatus('error');
        setTestMessage(data.error || 'Connection failed');
      }
    } catch (error) {
      setTestStatus('error');
      setTestMessage('Network error');
    }
  }

  async function saveSettings() {
    setSaving(true);

    try {
      const response = await authFetch('/api/email-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          ...formData,
        }),
      });

      if (response.ok) {
        await fetchSettings();
        navigate({ to: '/dashboard' });
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to save settings');
      }
    } catch (error) {
      alert('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    try {
      const response = await authFetch('/api/email-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: !settings?.imap_enabled,
        }),
      });

      if (response.ok) {
        await fetchSettings();
      }
    } catch (error) {
      console.error('Failed to toggle enabled:', error);
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Link to="/dashboard">
        <Button variant="ghost" size="sm" className="mb-4">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Dashboard
        </Button>
      </Link>
      <h1 className="text-3xl font-bold mb-6">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Email Ingestion</CardTitle>
          <CardDescription>
            Configure automatic document ingestion from your email inbox
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings && (
            <div className="flex items-center justify-between">
              <Label>Email Sync Enabled</Label>
              <Button
                variant={settings.imap_enabled ? 'default' : 'outline'}
                onClick={toggleEnabled}
              >
                {settings.imap_enabled ? 'Enabled' : 'Disabled'}
              </Button>
            </div>
          )}

          <div>
            <Label htmlFor="server">IMAP Server</Label>
            <Input
              id="server"
              value={formData.server}
              onChange={(e) => setFormData({ ...formData, server: e.target.value })}
              placeholder="imap.gmail.com"
            />
          </div>

          <div>
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
            />
          </div>

          <div>
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              placeholder="your-email@example.com"
            />
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Leave blank to keep existing"
            />
          </div>

          <div>
            <Label htmlFor="folder">Folder</Label>
            <Input
              id="folder"
              value={formData.folder}
              onChange={(e) => setFormData({ ...formData, folder: e.target.value })}
              placeholder="INBOX"
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={testConnection}
              disabled={testStatus === 'testing'}
              variant="outline"
            >
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </Button>

            <Button
              onClick={saveSettings}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>

          {testMessage && (
            <div className={`p-3 rounded ${
              testStatus === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {testMessage}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
