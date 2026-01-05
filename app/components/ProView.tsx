'use client';

import React from 'react';

export function ProView() {
  return (
    <div className="flex flex-col h-full bg-[#FDFCF8] overflow-y-auto pb-20">
      <div className="flex-1 px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-3 mb-6">
          <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-3xl font-bold text-stone-900">Premium Features</h1>
        </div>

        {/* Premium Banner */}
        <div className="bg-gradient-to-br from-amber-400 to-amber-600 rounded-3xl p-8 text-center shadow-lg">
          <svg className="w-20 h-20 text-white mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h2 className="text-2xl font-bold text-white mb-2">Upgrade to Premium</h2>
          <p className="text-amber-50 text-lg mb-6">
            Unlock advanced features and deeper insights into your journey
          </p>
          <button className="bg-white text-amber-600 font-semibold px-8 py-3 rounded-full hover:bg-amber-50 transition-colors shadow-md touch-manipulation">
            Learn More
          </button>
        </div>

        {/* Features List */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-stone-900">Premium Features</h3>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 mb-1">Advanced AI Insights</h4>
                <p className="text-sm text-stone-600">
                  Get deeper, more personalized reflections and pattern recognition
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 mb-1">Unlimited History</h4>
                <p className="text-sm text-stone-600">
                  Access your complete journal history without limits
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 mb-1">Custom Themes</h4>
                <p className="text-sm text-stone-600">
                  Personalize your journaling experience with custom themes
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 mb-1">Enhanced Privacy</h4>
                <p className="text-sm text-stone-600">
                  Advanced encryption and privacy controls for your entries
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 mb-1">Export & Backup</h4>
                <p className="text-sm text-stone-600">
                  Download your journal entries in multiple formats
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
