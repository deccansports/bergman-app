"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart3, TrendingUp } from 'lucide-react';

export default function ReportsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Reports & Analytics</h2>
        <p className="text-sm text-gray-600 mt-1">View reports and analytics on your workforce</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <BarChart3 className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold">Staffing Report</p>
                <p className="text-sm text-gray-600">Event-wise staff breakdown</p>
              </div>
            </div>
            <Button variant="outline" className="w-full">
              View Report
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-green-100 rounded-lg">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="font-semibold">Payment Report</p>
                <p className="text-sm text-gray-600">Payment summary and trends</p>
              </div>
            </div>
            <Button variant="outline" className="w-full">
              View Report
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-purple-100 rounded-lg">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="font-semibold">Skills Report</p>
                <p className="text-sm text-gray-600">Skills distribution</p>
              </div>
            </div>
            <Button variant="outline" className="w-full">
              View Report
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-orange-100 rounded-lg">
                <TrendingUp className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="font-semibold">City Report</p>
                <p className="text-sm text-gray-600">Workers by location</p>
              </div>
            </div>
            <Button variant="outline" className="w-full">
              View Report
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
