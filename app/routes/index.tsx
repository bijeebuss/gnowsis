/**
 * Landing Page
 * Task 8.2: Create landing page at /app/routes/index.tsx
 *
 * Features:
 * - Hero section with value proposition: "Search your documents with AI-powered OCR"
 * - Feature highlights using shadcn Card
 * - "Get Started" CTA Button linking to /signup
 * - Responsive Tailwind layout (mobile-first)
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Upload, Search, Zap } from 'lucide-react';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 sm:py-24">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
            Search your documents with AI-powered OCR
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8">
            Upload PDFs and images, extract searchable text automatically, and find what you need with powerful hybrid vector search.
          </p>
          <Link to="/signup">
            <Button size="lg" className="text-lg px-8 py-6">
              Get Started
            </Button>
          </Link>
        </div>
      </div>

      {/* Feature Highlights */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* Feature 1: Upload PDFs & Images */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle>Upload PDFs & Images</CardTitle>
              <CardDescription>
                Drag and drop or browse to upload PDF documents and images. Support for bulk uploads and real-time processing status.
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Feature 2: Automatic OCR Processing */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <Zap className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle>Automatic OCR Processing</CardTitle>
              <CardDescription>
                Advanced OCR technology extracts text from your documents automatically. Multi-page PDFs are processed seamlessly.
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Feature 3: Hybrid Vector Search */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <Search className="w-6 h-6 text-purple-600" />
              </div>
              <CardTitle>Hybrid Vector Search</CardTitle>
              <CardDescription>
                Find information using natural language or keywords. Combining dense and sparse vectors for superior search accuracy.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Secondary CTA */}
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground mb-4">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
