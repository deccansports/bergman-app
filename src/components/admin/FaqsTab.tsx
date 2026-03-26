// src/components/admin/FaqsTab.tsx
"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Trash2, Loader2, MessageCircleQuestion, Edit } from 'lucide-react';
import type { FaqEntry } from '@/lib/types';
import { addFaqAction, getFaqsAction, deleteFaqAction, updateFaqAction } from '@/lib/actions/faqActions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { format } from 'date-fns';

const FaqFormSchema = z.object({
  question: z.string().min(10, "Question must be at least 10 characters long."),
  answer: z.string().min(20, "Answer must be at least 20 characters long."),
});

type FaqFormInput = z.infer<typeof FaqFormSchema>;

export default function FaqsTab() {
  const { toast } = useToast();
  const [faqs, setFaqs] = useState<FaqEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [editingFaq, setEditingFaq] = useState<FaqEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const form = useForm<FaqFormInput>({
    resolver: zodResolver(FaqFormSchema),
    defaultValues: { question: '', answer: '' },
  });

  const fetchFaqs = useCallback(async () => {
    setIsLoading(true);
    const result = await getFaqsAction();
    if (result.success && result.faqs) {
      setFaqs(result.faqs);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchFaqs();
  }, [fetchFaqs]);
  
  useEffect(() => {
    if (isModalOpen) {
      if (editingFaq) {
        form.reset({
          question: editingFaq.question,
          answer: editingFaq.answer,
        });
      } else {
        form.reset({ question: '', answer: '' });
      }
    }
  }, [isModalOpen, editingFaq, form]);

  const handleFormSubmit = async (data: FaqFormInput) => {
    setIsSubmitting(true);
    const action = editingFaq
      ? updateFaqAction(editingFaq.id, data)
      : addFaqAction(data);

    const result = await action;
    if (result.success) {
      toast({ title: 'Success', description: result.message });
      await fetchFaqs(); // Refresh list
      setIsModalOpen(false);
      setEditingFaq(null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };


  const handleDeleteFaq = async (id: string) => {
    setIsDeleting(id);
    const result = await deleteFaqAction(id);
    if (result.success) {
      toast({ title: 'Success', description: 'FAQ deleted.' });
      await fetchFaqs(); // Refresh list
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsDeleting(null);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleQuestion className="h-5 w-5 text-primary" /> FAQ Management
            </CardTitle>
            <CardDescription>
              Add, edit, and delete Frequently Asked Questions for the user-facing chatbot.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => { setEditingFaq(null); setIsModalOpen(true); }}><PlusCircle className="mr-2 h-4 w-4"/>Add FAQ</Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Question</TableHead>
                  <TableHead className="w-[40%]">Answer</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={4} className="text-center h-24"><Loader2 className="animate-spin h-6 w-6 mx-auto text-primary"/></TableCell></TableRow>
                ) : faqs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No FAQs found. Add one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  faqs.map((faq) => (
                    <TableRow key={faq.id}>
                      <TableCell className="font-medium align-top">{faq.question}</TableCell>
                      <TableCell className="text-sm text-muted-foreground align-top">{faq.answer}</TableCell>
                      <TableCell className="text-xs text-muted-foreground align-top">{faq.createdAt ? format(new Date(faq.createdAt), 'MMM dd, yyyy') : 'N/A'}</TableCell>
                      <TableCell className="text-right align-top space-x-1">
                         <Button variant="ghost" size="xs" onClick={() => { setEditingFaq(faq); setIsModalOpen(true); }}>
                           <Edit className="h-3.5 w-3.5" />
                         </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" disabled={isDeleting === faq.id}>
                              {isDeleting === faq.id ? <Loader2 className="animate-spin h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this FAQ?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the question: &quot;{faq.question}&quot;
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteFaq(faq.id)} className="bg-destructive hover:bg-destructive/90">
                                Yes, Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{editingFaq ? 'Edit FAQ' : 'Add New FAQ'}</DialogTitle>
            </DialogHeader>
             <Form {...form}>
              <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="question"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Question</FormLabel>
                      <Input placeholder="Enter the question..." {...field} disabled={isSubmitting} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="answer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Answer</FormLabel>
                      <Textarea placeholder="Provide the answer..." {...field} disabled={isSubmitting} rows={4}/>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
                      {editingFaq ? 'Save Changes' : 'Add FAQ'}
                    </Button>
                </DialogFooter>
              </form>
            </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
